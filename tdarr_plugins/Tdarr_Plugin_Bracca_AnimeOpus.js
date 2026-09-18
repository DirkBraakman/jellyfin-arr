/* eslint-disable */
"use strict";

// Tdarr Plugin - Anime: JP + Optional EN Opus Audio + Best EN Subtitles
// Selects best JP audio → Opus, best EN audio → Opus, best EN dialogue subtitle.
// Strips all other tracks. Fails ONLY if no JP audio is found.
// English subtitles are OPTIONAL — if none are found (or none pass filtering),
// the file is still processed without one, so Bazarr (or similar) can add
// SRT subs afterwards without this plugin fighting it.
// Commentary tracks are always excluded from selection (audio + subs).
// Subtitle preference: Full/Complete/Main/Dialogue+Signs > Dialogue > Honorifics

const details = () => ({
  id: "Tdarr_Plugin_Bracca_AnimeOpus",
  Stage: "Pre-processing",
  Name: "Bracca - Anime JP/EN Opus Audio + Best EN Subtitle",
  Type: "Video",
  Operation: "Transcode",
  Description:
    "Encodes best JP/EN audio to Opus, keeps best EN dialogue subtitle if present, strips other tracks and commentary. Fails only if no Japanese audio is found - English subtitles are optional (e.g. added later by Bazarr).",
  Version: "2.1",
  Tags: "anime,audio,opus,subtitle,japanese,english,bazarr",
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

  // Normalize language tag: 'jpn', 'eng', raw value (lower-case), or null
  const normLang = (s) => {
    const raw = ((s.tags && (s.tags.language || s.tags.LANGUAGE)) || "")
      .toLowerCase()
      .trim();
    if (raw === "ja" || raw === "jpn") return "jpn";
    if (raw === "en" || raw === "eng") return "eng";
    // Only trust further unmapped codes if they look like a real ISO 639 tag —
    // anything else is untrusted file metadata and must not reach the ffmpeg args.
    return /^[a-z]{2,3}$/.test(raw) ? raw : null;
  };

  const trackTitle = (s) => (s.tags && (s.tags.title || s.tags.TITLE)) || "";

  // Commentary tracks are never eligible, for audio or subtitles.
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
  // Format: ASS=400 > PGS=300 > SRT=200 > VobSub=100
  // Preference: Dialogue+Signs > Dialogue > Honorifics
  const subScore = (s) => {
    const codec = (s.codec_name || "").toLowerCase();
    const title = trackTitle(s);
    const titleLow = title.toLowerCase();
    const disp = s.disposition || {};

    if (disp.forced === 1 || /\bforced\b/i.test(title)) {
      log(`  [sub skip] stream ${s.index} – forced: "${title}"`);
      return -1;
    }

    if (isCommentary(s)) {
      log(`  [sub skip] stream ${s.index} – commentary: "${title}"`);
      return -1;
    }

    const skipPatterns = [
      /^signs?(\s+only)?$/i,
      /^signs?\s*[&+\/]\s*songs?$/i,
      /^songs?\s*[&+\/]\s*signs?$/i,
      /^songs?\s*only$/i,
      /^lyrics?\s*only$/i,
      /\bsigns?\s*only\b/i,
      /\bno[- ]dialogue\b/i,
    ];
    if (skipPatterns.some((rx) => rx.test(titleLow))) {
      log(`  [sub skip] stream ${s.index} – signs/songs-only: "${title}"`);
      return -1;
    }

    let score = 0;
    if (codec === "ass" || codec === "ssa") score = 400;
    else if (["hdmv_pgs_subtitle", "pgssub", "pgs"].includes(codec))
      score = 300;
    else if (["subrip", "srt", "webvtt"].includes(codec)) score = 200;
    else if (["dvd_subtitle", "dvdsub", "vobsub"].includes(codec)) score = 100;
    else score = 50;

    // Preference tiers:
    // Tier 1 (best): Full/Complete/Main OR Dialogue+Signs
    // Tier 2: Dialogue only (not with signs)
    // Tier 3: Honorifics
    if (/\b(full|complete|main)\b/i.test(title)) score += 100;
    else if (/\b(dialogue|dialog)\s*[&+]\s*(signs?|honorifics?)\b/i.test(title))
      score += 100;
    else if (/\b(dialogue|dialog)\b/i.test(title)) score += 50;
    else if (/\bhonorific/i.test(title)) score += 25;

    return score;
  };

  const subFormatName = (codec) => {
    const c = (codec || "").toLowerCase();
    if (c === "ass" || c === "ssa") return "ASS";
    if (["hdmv_pgs_subtitle", "pgssub", "pgs"].includes(c)) return "PGS";
    if (c === "subrip" || c === "srt") return "SRT";
    if (c === "webvtt") return "VTT";
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
    throw new Error(`[Anime Plugin] No video stream. File: ${file.file}`);
  }

  // Prefer the real video track over a leading attached-picture (cover art) stream.
  const primaryVideo =
    vidStreams.find((s) => (s.disposition || {}).attached_pic !== 1) ||
    vidStreams[0];

  // ── Japanese audio ──────────────────────────────────────────────────────
  const jpCommentary = audStreams.filter(
    (s) => normLang(s) === "jpn" && isCommentary(s),
  );
  jpCommentary.forEach((s) =>
    log(`  [audio skip] stream ${s.index} – commentary: "${trackTitle(s)}"`),
  );

  const jpCandidates = audStreams
    .filter((s) => normLang(s) === "jpn" && !isCommentary(s))
    .map((s) => ({ s, score: audioScore(s) }))
    .sort((a, b) => b.score - a.score);

  log("── Japanese audio candidates ──");
  if (jpCandidates.length === 0) {
    log("  (none)");
  } else {
    jpCandidates.forEach((x, i) => {
      log(
        `  #${i + 1} stream ${x.s.index} ${x.s.codec_name} ${x.s.channels}ch score=${x.score} "${trackTitle(x.s)}"`,
      );
    });
  }

  if (jpCandidates.length === 0) {
    log("");
    log("[FAIL] No Japanese audio found – manual review needed.");
    throw new Error(`[Anime Plugin] No Japanese audio. File: ${file.file}`);
  }

  const bestJP = jpCandidates[0].s;
  log(
    `→ Selected JP: stream ${bestJP.index} (${bestJP.codec_name} ${bestJP.channels}ch)`,
  );
  log("");

  // ── English audio (optional) ────────────────────────────────────────────
  const enAudioCommentary = audStreams.filter(
    (s) => normLang(s) === "eng" && isCommentary(s),
  );
  enAudioCommentary.forEach((s) =>
    log(`  [audio skip] stream ${s.index} – commentary: "${trackTitle(s)}"`),
  );

  const enAudioCandidates = audStreams
    .filter((s) => normLang(s) === "eng" && !isCommentary(s))
    .map((s) => ({ s, score: audioScore(s) }))
    .sort((a, b) => b.score - a.score);

  log("── English audio candidates ──");
  if (enAudioCandidates.length === 0) {
    log("  (none) – JP audio only");
  } else {
    enAudioCandidates.forEach((x, i) => {
      log(
        `  #${i + 1} stream ${x.s.index} ${x.s.codec_name} ${x.s.channels}ch score=${x.score} "${trackTitle(x.s)}"`,
      );
    });
  }
  const bestEN = enAudioCandidates[0] ? enAudioCandidates[0].s : null;
  if (bestEN) {
    log(
      `→ Selected EN: stream ${bestEN.index} (${bestEN.codec_name} ${bestEN.channels}ch)`,
    );
  }
  log("");

  // ── English subtitle (optional — Bazarr can fill the gap) ──────────────
  const subCandidates = subStreams
    .filter((s) => normLang(s) === "eng")
    .map((s) => ({ s, score: subScore(s) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);

  log("── English subtitle candidates ──");
  if (subCandidates.length === 0) {
    log("  (none after filtering)");
  } else {
    subCandidates.forEach((x, i) => {
      log(
        `  #${i + 1} stream ${x.s.index} ${x.s.codec_name} score=${x.score} "${trackTitle(x.s)}"`,
      );
    });
  }
  const bestSub = subCandidates[0] ? subCandidates[0].s : null;

  if (!bestSub) {
    log("");
    log(
      "[WARN] No suitable English subtitle found – continuing WITHOUT a subtitle track (Bazarr can add one later).",
    );
  } else {
    log(`→ Selected EN sub: stream ${bestSub.index} (${bestSub.codec_name})`);
  }
  log("");

  const expectedAudioCount = bestEN ? 2 : 1;
  const expectedSubCount = bestSub ? 1 : 0;
  const jpTitleOk = /japanese/i.test(trackTitle(bestJP));
  const enTitleOk = !bestEN || /english/i.test(trackTitle(bestEN));
  const subTitleOk = !bestSub || /english/i.test(trackTitle(bestSub));

  const audioSubProcessed =
    audStreams.length === expectedAudioCount &&
    subStreams.length === expectedSubCount &&
    (bestJP.codec_name || "").toLowerCase() === "opus" &&
    (bestJP.disposition || {}).default === 1 &&
    jpTitleOk &&
    (!bestEN || (bestEN.codec_name || "").toLowerCase() === "opus") &&
    enTitleOk &&
    (!bestSub || (bestSub.disposition || {}).default === 1) &&
    subTitleOk;

  if (audioSubProcessed) {
    log("[INFO] Already in target format – skipping.");
    response.processFile = false;
    return response;
  }

  // FFmpeg preset: -map selects streams. Other streams are dropped.

  const parts = [];

  parts.push(`-map 0:${primaryVideo.index} -c:v copy`);
  parts.push("-map 0:t? -c:t copy"); // keep embedded fonts for styled ASS subs

  // Builds the ffmpeg args for one audio track: map, encode/copy, metadata, disposition.
  const addAudioTrack = (stream, idx, label, langCode, isDefault) => {
    const isOpus = (stream.codec_name || "").toLowerCase() === "opus";
    parts.push(`-map 0:${stream.index}`);
    if (isOpus) {
      parts.push(`-c:a:${idx} copy`);
      log(`[${label} audio] Already Opus – copying.`);
    } else {
      const downmix = needsDownmix(stream);
      const encCh = downmix ? 6 : stream.channels;
      const br = opusBitrate(encCh);
      parts.push(`-c:a:${idx} libopus -b:a:${idx} ${br}`);
      if (downmix) {
        parts.push(`-ac:a:${idx} 6`);
        log(
          `[${label} audio] Non-standard layout (${stream.channel_layout || stream.channels + "ch"}) – downmixing to 5.1 before Opus encode @ ${br}.`,
        );
      } else {
        log(`[${label} audio] Encoding ${stream.codec_name} → Opus @ ${br}.`);
      }
    }
    parts.push(`-metadata:s:a:${idx} "title=${label} - Opus"`);
    parts.push(`-metadata:s:a:${idx} language=${langCode}`);
    parts.push(`-disposition:a:${idx} ${isDefault ? "default" : 0}`);
  };

  let aIdx = 0;
  addAudioTrack(bestJP, aIdx, "Japanese", "jpn", true);
  aIdx += 1;

  if (bestEN) {
    addAudioTrack(bestEN, aIdx, "English", "eng", false);
    aIdx += 1;
  }

  if (bestSub) {
    const fmt = subFormatName(bestSub.codec_name);
    parts.push(`-map 0:${bestSub.index}`);
    parts.push(`-c:s:0 copy`);
    parts.push(`-metadata:s:s:0 "title=English - ${fmt}"`);
    parts.push(`-metadata:s:s:0 language=eng`);
    parts.push(`-disposition:s:0 default`);
  }

  parts.push("-max_muxing_queue_size 9999");

  log("── Output summary ──");
  log(`  Video [0] : stream ${primaryVideo.index} copy`);
  log(`  Audio [0] : stream ${bestJP.index} Opus (def) "Japanese - Opus"`);
  if (bestEN) log(`  Audio [1] : stream ${bestEN.index} Opus "English - Opus"`);
  if (bestSub) {
    log(
      `  Sub   [0] : stream ${bestSub.index} copy (def) "English - ${subFormatName(bestSub.codec_name)}"`,
    );
  } else {
    log(`  Sub   [-] : none mapped – awaiting external sub (e.g. Bazarr)`);
  }
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
