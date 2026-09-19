/* eslint-disable */
"use strict";

// Tdarr Plugin - Original Language + EN/NL Subtitles
// Selects original audio → Opus (default), keeps best subtitles with preferences
// SRT > VTT > other formats. English & Dutch optional. All other tracks stripped.
// If no track is explicitly tagged "Original"/"Main", falls back to the
// highest-scored non-commentary audio track (not just the first one).

const details = () => ({
  id: "Tdarr_Plugin_Bracca_OrginalOpus",
  Stage: "Pre-processing",
  Name: "Bracca - Original Opus Audio + EN/NL Subtitles",
  Type: "Video",
  Operation: "Transcode",
  Description:
    "Encodes original audio to Opus (default), keeps best SRT/VTT subtitles. Adds optional EN/NL subtitles. Strips other tracks and commentary. Falls back to the best-scored non-commentary audio track when no track is tagged Original/Main.",
  Version: "1.1",
  Tags: "audio,opus,subtitle,multilingual,original",
  Inputs: [],
});

// ─────────────────────────────────────────────────────────────────────────────
//  Plugin entry-point
// ─────────────────────────────────────────────────────────────────────────────
const plugin = (file, librarySettings, inputs, otherArguments) => {
  const response = {
    processFile: false,
    preset: "",
    container: ".mkv",
    handBrakeMode: false,
    FFmpegMode: true,
    reQueueAfter: false,
    infoLog: "",
  };

  // Append a line to the job log
  const log = (msg) => {
    response.infoLog += `${msg}\n`;
  };

  if (!file.ffProbeData || !Array.isArray(file.ffProbeData.streams)) {
    log("[ERROR] No ffprobe data available.");
    return response;
  }

  const { streams } = file.ffProbeData;
  log(`File: ${file.file}`);

  // Normalize language tag: 'jpn', 'eng', 'nld', raw value (lower-case), or null
  const normLang = (s) => {
    const raw = ((s.tags && (s.tags.language || s.tags.LANGUAGE)) || "")
      .toLowerCase()
      .trim();
    if (raw === "ja" || raw === "jpn") return "jpn";
    if (raw === "en" || raw === "eng") return "eng";
    if (raw === "nl" || raw === "nld") return "nld";
    if (raw === "fr" || raw === "fra" || raw === "fre") return "fra";
    if (raw === "de" || raw === "deu") return "deu";
    if (raw === "es" || raw === "spa") return "spa";
    // Only trust further unmapped codes if they look like a real ISO 639 tag —
    // anything else is untrusted file metadata and must not reach the ffmpeg args.
    return /^[a-z]{2,3}$/.test(raw) ? raw : null;
  };

  // Get language name for display
  const langName = (lang) => {
    const map = {
      jpn: "Japanese",
      eng: "English",
      nld: "Dutch",
      fra: "French",
      deu: "German",
      spa: "Spanish",
      ita: "Italian",
    };
    return map[lang] || (lang ? lang.toUpperCase() : "Unknown");
  };

  const trackTitle = (s) => (s.tags && (s.tags.title || s.tags.TITLE)) || "";

  const isCommentary = (s) => /\bcommentary\b/i.test(trackTitle(s));

  // Audio quality score: higher is better. Ties broken by channel count.
  const audioScore = (s) => {
    const codec = (s.codec_name || "").toLowerCase();
    const profile = (s.profile || "").toLowerCase();
    const ch = parseInt(s.channels, 10) || 2;
    let base = 100;
    if (codec.startsWith("pcm")) base = 1000;
    else if (codec === "truehd") base = profile.includes("atmos") ? 950 : 900;
    else if (codec === "flac") base = 850;
    else if (codec === "dts") {
      if (profile.includes("ma")) base = 800;
      else if (profile.includes("hra")) base = 750;
      else if (profile.includes("es")) base = 700;
      else base = 600;
    } else if (codec === "eac3") base = profile.includes("atmos") ? 560 : 520;
    else if (codec === "ac3") base = 400;
    else if (codec === "aac") base = 380;
    else if (codec === "opus") base = 270;
    else if (codec === "vorbis") base = 250;
    else if (codec === "mp3") base = 200;
    return base + Math.min(ch, 8) * 10;
  };

  // Target Opus bitrate based on channel count
  const opusBitrate = (ch) => {
    const n = parseInt(ch, 10) || 2;
    if (n <= 1) return "96k";
    if (n <= 2) return "128k";
    if (n <= 4) return "192k";
    if (n <= 6) return "256k";
    return "320k";
  };

  // libopus (mapping family 1) only supports specific discrete layouts:
  // mono, stereo, 5.1 and 7.1 in standard order. Non-standard/Atmos or
  // height-channel layouts (e.g. 7.1(wide), 5.1.2) are rejected outright.
  // Whitelist known-good layouts instead of guessing from channel count alone,
  // so a clean 7.1 source isn't needlessly downmixed to 5.1.
  const OPUS_SAFE_LAYOUTS = new Set([
    "mono", "stereo", "3.0", "quad", "5.0", "5.0(side)", "5.1", "5.1(side)", "7.1",
  ]);
  const needsDownmix = (s) => {
    const ch = parseInt(s.channels, 10) || 2;
    const layout = `${s.channel_layout || ""}`.toLowerCase();
    if (ch <= 2) return false;
    return !OPUS_SAFE_LAYOUTS.has(layout);
  };

  // Subtitle quality score. Returns -1 if should be skipped.
  // Format: SRT=300 > VTT=200 > ASS=150 > PGS=100 > VobSub=50
  // Preference: Full/Complete/Main/Dialogue > others
  const subScore = (s) => {
    const codec = (s.codec_name || "").toLowerCase();
    const title = trackTitle(s);
    const disp = s.disposition || {};

    // Skip forced and commentary subtitles
    if (disp.forced === 1 || /\bforced\b/i.test(title) || isCommentary(s)) {
      log(`  [sub skip] stream ${s.index} – forced/commentary: "${title}"`);
      return -1;
    }

    // Format scoring (SRT preferred > VTT > ASS > others)
    let score = 0;
    if (codec === "subrip" || codec === "srt") score = 300;
    else if (codec === "webvtt") score = 200;
    else if (codec === "ass" || codec === "ssa") score = 150;
    else if (["hdmv_pgs_subtitle", "pgssub", "pgs"].includes(codec))
      score = 100;
    else if (["dvd_subtitle", "dvdsub", "vobsub"].includes(codec)) score = 50;
    else score = 25;

    // Title preference: Full/Complete/Main/Dialogue are hitwords
    if (/\b(full|complete|main|dialogue|dialog)\b/i.test(title)) score += 50;

    return score;
  };

  const subFormatName = (codec) => {
    const c = (codec || "").toLowerCase();
    if (c === "subrip" || c === "srt") return "SRT";
    if (c === "webvtt") return "VTT";
    if (c === "ass" || c === "ssa") return "ASS";
    if (["hdmv_pgs_subtitle", "pgssub", "pgs"].includes(c)) return "PGS";
    if (["dvd_subtitle", "dvdsub", "vobsub"].includes(c)) return "VobSub";
    return c.toUpperCase();
  };

  const vidStreams = streams.filter((s) => s.codec_type === "video");
  const audStreams = streams.filter((s) => s.codec_type === "audio");
  const subStreams = streams.filter((s) => s.codec_type === "subtitle");

  log(
    `Streams: ${vidStreams.length}V | ${audStreams.length}A | ${subStreams.length}S`,
  );
  log("");

  if (vidStreams.length === 0) {
    log("[ERROR] No video stream.");
    throw new Error(`[Original Opus Plugin] No video stream. File: ${file.file}`);
  }

  if (audStreams.length === 0) {
    log("[ERROR] No audio stream.");
    throw new Error(`[Original Opus Plugin] No audio stream. File: ${file.file}`);
  }

  // Prefer the real video track over a leading attached-picture (cover art) stream.
  const primaryVideo =
    vidStreams.find((s) => (s.disposition || {}).attached_pic !== 1) ||
    vidStreams[0];

  // ── Original audio detection ────────────────────────────────────────────
  // 1) Prefer a track explicitly tagged "Original"/"Main" (and not commentary).
  // 2) Otherwise fall back to the best-SCORED non-commentary track — not
  //    just the first one in stream order.
  let originalAudio = audStreams.find((s) => {
    const title = trackTitle(s);
    return /original|main/i.test(title) && !isCommentary(s);
  });

  if (!originalAudio) {
    log("── Original audio detection ──");
    log(
      `  [WARN] No track with 'Original' or 'Main' in title found. Falling back to best-scored non-commentary audio track.`,
    );

    const nonCommentary = audStreams.filter((s) => !isCommentary(s));

    if (nonCommentary.length === 0) {
      log("");
      log("[ERROR] All audio tracks are marked commentary – manual review needed.");
      throw new Error(`[Original Opus Plugin] All audio tracks are commentary. File: ${file.file}`);
    }

    const scoredFallback = nonCommentary
      .map((s) => ({ s, score: audioScore(s) }))
      .sort((a, b) => b.score - a.score);

    scoredFallback.forEach((x, i) => {
      log(
        `  #${i + 1} stream ${x.s.index} ${x.s.codec_name} ${x.s.channels}ch score=${x.score} "${trackTitle(x.s)}"`,
      );
    });

    originalAudio = scoredFallback[0].s;
    log("");
  }

  const originalLang = normLang(originalAudio);
  log("── Original audio detected ──");
  log(
    `  Stream ${originalAudio.index}: ${originalAudio.codec_name} ${originalAudio.channels}ch`,
  );
  log(
    `  Language: ${originalLang ? langName(originalLang) : "Unknown"} (${originalLang || "??"})`,
  );
  log(`  Title: "${trackTitle(originalAudio) || "(no title)"}"`);
  log("");

  // Find best English subtitle
  const enSubCandidates = subStreams
    .filter((s) => normLang(s) === "eng")
    .map((s) => ({ s, score: subScore(s) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);

  log("── English subtitle candidates ──");
  if (enSubCandidates.length === 0) {
    log("  (none after filtering)");
  } else {
    enSubCandidates.forEach((x, i) => {
      log(
        `  #${i + 1} stream ${x.s.index} ${x.s.codec_name} score=${x.score} "${trackTitle(x.s)}"`,
      );
    });
  }
  const bestEnSub = enSubCandidates[0] ? enSubCandidates[0].s : null;
  log("");

  // Find best Dutch subtitle
  const nlSubCandidates = subStreams
    .filter((s) => normLang(s) === "nld")
    .map((s) => ({ s, score: subScore(s) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);

  log("── Dutch subtitle candidates ──");
  if (nlSubCandidates.length === 0) {
    log("  (none after filtering)");
  } else {
    nlSubCandidates.forEach((x, i) => {
      log(
        `  #${i + 1} stream ${x.s.index} ${x.s.codec_name} score=${x.score} "${trackTitle(x.s)}"`,
      );
    });
  }
  const bestNlSub = nlSubCandidates[0] ? nlSubCandidates[0].s : null;
  log("");

  // Prepare FFmpeg preset
  const parts = [];

  // Video: copy
  parts.push(`-map 0:${primaryVideo.index} -c:v copy`);
  parts.push("-map 0:t? -c:t copy"); // keep embedded fonts for styled ASS subs

  // Audio: original as Opus default
  let aIdx = 0;
  const originalIsOpus =
    (originalAudio.codec_name || "").toLowerCase() === "opus";

  parts.push(`-map 0:${originalAudio.index}`);
  if (originalIsOpus) {
    parts.push(`-c:a:${aIdx} copy`);
    log(`[Original audio] Already Opus – copying.`);
  } else {
    const downmix = needsDownmix(originalAudio);
    const encCh = downmix ? 6 : originalAudio.channels;
    const br = opusBitrate(encCh);
    parts.push(`-c:a:${aIdx} libopus -b:a:${aIdx} ${br}`);
    if (downmix) {
      parts.push(`-ac:a:${aIdx} 6`);
      log(
        `[Original audio] Non-standard layout (${originalAudio.channel_layout || originalAudio.channels + "ch"}) – downmixing to 5.1 before Opus encode @ ${br}.`,
      );
    } else {
      log(
        `[Original audio] Encoding ${originalAudio.codec_name} → Opus @ ${br}.`,
      );
    }
  }

  const originalLangDisplay = originalLang
    ? langName(originalLang)
    : "Original";
  const expectedAudioTitle = `${originalLangDisplay} - Opus`;
  const actualAudioTitle = trackTitle(originalAudio);
  const audioTitleOk = actualAudioTitle === expectedAudioTitle;

  parts.push(`-metadata:s:a:${aIdx} "title=${originalLangDisplay} - Opus"`);
  if (originalLang) {
    parts.push(`-metadata:s:a:${aIdx} language=${originalLang}`);
  }
  parts.push(`-disposition:a:${aIdx} default`);
  aIdx += 1;

  // Subtitles (all defaulted to off)
  let sIdx = 0;
  let enSubOutIdx = null;
  let nlSubOutIdx = null;

  if (bestEnSub) {
    const fmt = subFormatName(bestEnSub.codec_name);
    enSubOutIdx = sIdx;
    parts.push(`-map 0:${bestEnSub.index}`);
    parts.push(`-c:s:${sIdx} copy`);
    parts.push(`-metadata:s:s:${sIdx} "title=English - ${fmt}"`);
    parts.push(`-metadata:s:s:${sIdx} language=eng`);
    parts.push(`-disposition:s:${sIdx} 0`);
    log(
      `[EN Sub] Selected stream ${bestEnSub.index} (${fmt}) – OPTIONAL (not default)`,
    );
    sIdx += 1;
  }

  if (bestNlSub) {
    const fmt = subFormatName(bestNlSub.codec_name);
    nlSubOutIdx = sIdx;
    parts.push(`-map 0:${bestNlSub.index}`);
    parts.push(`-c:s:${sIdx} copy`);
    parts.push(`-metadata:s:s:${sIdx} "title=Dutch - ${fmt}"`);
    parts.push(`-metadata:s:s:${sIdx} language=nld`);
    parts.push(`-disposition:s:${sIdx} 0`);
    log(
      `[NL Sub] Selected stream ${bestNlSub.index} (${fmt}) – OPTIONAL (not default)`,
    );
    sIdx += 1;
  }

  parts.push("-max_muxing_queue_size 9999");

  // Check if already in target format
  const expectedSubCount = (bestEnSub ? 1 : 0) + (bestNlSub ? 1 : 0);
  const audioSubProcessed =
    audStreams.length === 1 &&
    (originalAudio.codec_name || "").toLowerCase() === "opus" &&
    (originalAudio.disposition || {}).default === 1 &&
    audioTitleOk &&
    subStreams.length === expectedSubCount;

  if (audioSubProcessed) {
    log("[INFO] Already in target format – skipping.");
    response.processFile = false;
    return response;
  }

  log("");
  log("── Output summary ──");
  log(`  Video [0] : stream ${primaryVideo.index} copy`);
  log(
    `  Audio [0] : stream ${originalAudio.index} Opus (default) "${originalLangDisplay} - Opus"`,
  );
  if (bestEnSub)
    log(
      `  Sub   [${enSubOutIdx}] : stream ${bestEnSub.index} copy "English - ${subFormatName(bestEnSub.codec_name)}"`,
    );
  if (bestNlSub)
    log(
      `  Sub   [${nlSubOutIdx}] : stream ${bestNlSub.index} copy "Dutch - ${subFormatName(bestNlSub.codec_name)}"`,
    );
  log("");

  response.preset = "," + parts.join(" ");
  response.container = ".mkv";
  response.processFile = true;

  log("── FFmpeg preset ──");
  log(response.preset);

  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;
