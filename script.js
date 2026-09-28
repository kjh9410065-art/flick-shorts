// FLiCK Shorts의 브라우저 기반 영상 편집 기능을 제어합니다.
// FFmpeg는 영상 렌더링에, Transformers.js의 Whisper는 STT 자동 자막에 사용합니다.
// Web Audio API는 음악의 에너지 피크를 분석해 비트 기반 컷 지점을 계산합니다.

import { FFmpeg } from "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js";
import { fetchFile, toBlobURL } from "https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js";

const videoInput = document.getElementById("videoInput");
const audioInput = document.getElementById("audioInput");
const previewVideo = document.getElementById("previewVideo");
const emptyPreview = document.getElementById("emptyPreview");
const fileInfo = document.getElementById("fileInfo");
const fileName = document.getElementById("fileName");
const fileMeta = document.getElementById("fileMeta");
const renderBtn = document.getElementById("renderBtn");
const transcribeBtn = document.getElementById("transcribeBtn");
const durationSelect = document.getElementById("duration");
const positionSelect = document.getElementById("position");
const cutModeSelect = document.getElementById("cutMode");
const beatEdit = document.getElementById("beatEdit");
const overlayText = document.getElementById("overlayText");
const previewOverlay = document.getElementById("previewOverlay");
const audioName = document.getElementById("audioName");
const clearAudio = document.getElementById("clearAudio");
const removeVideo = document.getElementById("removeVideo");
const dropzone = document.getElementById("dropzone");
const status = document.getElementById("status");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const progressPercent = document.getElementById("progressPercent");
const downloadBtn = document.getElementById("downloadBtn");
const subtitleBox = document.getElementById("subtitleBox");
const subtitleStatus = document.getElementById("subtitleStatus");
const subtitleLanguage = document.getElementById("subtitleLanguage");
const subtitleList = document.getElementById("subtitleList");
const stages = [...document.querySelectorAll(".stage")];

const ffmpeg = new FFmpeg();
let videoFile = null;
let audioFile = null;
let videoObjectUrl = null;
let outputObjectUrl = null;
let ffmpegLoaded = false;
let sourceDuration = 0;
let progressListenerAttached = false;
let transcriber = null;
let subtitleSegments = [];
let subtitleFontLoaded = false;
let beatCuts = [];

// 화면에 상태 메시지를 표시합니다.
function setStatus(message) {
  status.textContent = message;
}

// 파일 크기를 읽기 쉬운 단위로 표시합니다.
function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / 1024 ** index).toFixed(index ? 1 : 0) + " " + units[index];
}

// 현재 개발 단계를 UI에 반영합니다.
function setStage(activeNumber) {
  stages.forEach((stage, index) => stage.classList.toggle("active", index < activeNumber));
}

// 영상 파일을 선택하고 메타데이터를 읽습니다.
function setVideo(file) {
  if (!file || !file.type.startsWith("video/")) {
    setStatus("영상 파일만 선택할 수 있습니다.");
    return;
  }

  videoFile = file;
  subtitleSegments = [];
  beatCuts = [];
  subtitleBox.hidden = true;
  subtitleList.innerHTML = "";
  subtitleStatus.textContent = "대기 중";

  if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
  videoObjectUrl = URL.createObjectURL(file);
  previewVideo.src = videoObjectUrl;
  previewVideo.hidden = false;
  emptyPreview.hidden = true;
  fileInfo.hidden = false;
  fileName.textContent = file.name;
  fileMeta.textContent = `${formatBytes(file.size)} · ${file.type}`;

  const probe = document.createElement("video");
  const metadataUrl = URL.createObjectURL(file);
  probe.preload = "metadata";
  probe.onloadedmetadata = () => {
    sourceDuration = Number.isFinite(probe.duration) ? probe.duration : 0;
    URL.revokeObjectURL(metadataUrl);
    renderBtn.disabled = false;
    transcribeBtn.disabled = false;
    setStage(1);
    setStatus("영상이 준비되었습니다. 자동 자막과 비트 편집을 선택할 수 있습니다.");
  };
  probe.onerror = () => {
    URL.revokeObjectURL(metadataUrl);
    renderBtn.disabled = false;
    transcribeBtn.disabled = false;
    setStage(1);
    setStatus("영상이 준비되었습니다. 옵션을 선택하세요.");
  };
  probe.src = metadataUrl;
  updateOverlay();
}

// 선택한 쇼츠 길이를 계산합니다.
function getTargetDuration() {
  const requested = Number(durationSelect.value);
  if (!sourceDuration || requested === 0) return sourceDuration || 0;
  return Math.min(requested, sourceDuration);
}

// 일반 자동 컷의 시작 시점을 계산합니다.
function getCutStart() {
  const target = getTargetDuration();
  const available = Math.max(0, sourceDuration - target);
  if (!available) return 0;
  if (cutModeSelect.value === "start") return 0;
  if (cutModeSelect.value === "end") return available;
  return available / 2;
}

// 영상 비율을 유지하면서 9:16으로 크롭합니다.
function buildCropFilter() {
  const position = positionSelect.value;
  if (position === "left") return "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:0:(ih-1920)/2";
  if (position === "right") return "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:iw-1080:(ih-1920)/2";
  return "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)/2:(ih-1920)/2";
}

// 입력한 화면 문구를 미리보기에 표시합니다.
function updateOverlay() {
  const text = overlayText.value.trim();
  previewOverlay.textContent = text;
  previewOverlay.hidden = !text;
}

// FFmpeg 엔진을 최초 한 번만 불러옵니다.
async function loadFFmpeg() {
  if (ffmpegLoaded) return;
  setProgress(8, "영상 편집 엔진을 불러오는 중...");
  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });
  ffmpegLoaded = true;
}

// FFmpeg 진행률 이벤트를 한 번만 연결합니다.
function attachProgressListener() {
  if (progressListenerAttached) return;
  ffmpeg.on("progress", ({ progress }) => setProgress(20 + progress * 72, "영상을 렌더링하는 중..."));
  progressListenerAttached = true;
}

// 진행률을 화면에 표시합니다.
function setProgress(percent, message) {
  progressWrap.hidden = false;
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressText.textContent = message;
}

// FFmpeg drawtext용 문자열을 안전하게 이스케이프합니다.
function escapeDrawText(text) {
  return text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,").replace(/%/g, "\\%");
}

// 자막 한 줄 길이를 제한합니다.
function wrapSubtitleText(text, maxChars = 24) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  const parts = [];
  for (let i = 0; i < clean.length; i += maxChars) parts.push(clean.slice(i, i + maxChars));
  return parts.slice(0, 2).join("\\n");
}

// Whisper 모델을 최초 한 번만 로드합니다.
async function loadWhisper() {
  if (transcriber) return transcriber;
  setProgress(8, "AI 음성 인식 모델을 불러오는 중...");
  const { pipeline } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1");
  transcriber = await pipeline("automatic-speech-recognition", "Xenova/whisper-tiny", { dtype: "q8" });
  return transcriber;
}

// 현재 컷 구간의 오디오를 16kHz mono WAV로 추출합니다.
async function extractSpeechAudio() {
  const targetDuration = getTargetDuration();
  const cutStart = getCutStart();
  await ffmpeg.writeFile("input.mp4", await fetchFile(videoFile));
  await ffmpeg.exec(["-ss", String(cutStart), "-t", String(targetDuration || 30), "-i", "input.mp4", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-y", "speech.wav"]);
  return ffmpeg.readFile("speech.wav");
}

// STT 결과를 편집 가능한 자막 목록으로 표시합니다.
function renderSubtitleEditor() {
  subtitleList.innerHTML = "";
  if (!subtitleSegments.length) {
    subtitleList.innerHTML = '<div class="subtitle-empty">인식된 음성이 없습니다.</div>';
    return;
  }
  subtitleSegments.forEach((segment, index) => {
    const row = document.createElement("div");
    row.className = "subtitle-item";
    row.innerHTML = `<span class="subtitle-time">${formatTime(segment.start)}<br />${formatTime(segment.end)}</span><input class="subtitle-input" data-subtitle-index="${index}" value="${escapeHtml(segment.text)}" maxlength="80" />`;
    subtitleList.appendChild(row);
  });
  subtitleList.querySelectorAll(".subtitle-input").forEach((input) => {
    input.addEventListener("input", (event) => {
      const index = Number(event.currentTarget.dataset.subtitleIndex);
      subtitleSegments[index].text = event.currentTarget.value;
    });
  });
}

// 초를 mm:ss로 표시합니다.
function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

// HTML 특수문자를 안전하게 변환합니다.
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// 선택한 영상의 음성을 Whisper로 분석합니다.
async function generateSubtitles() {
  if (!videoFile) return;
  transcribeBtn.disabled = true;
  renderBtn.disabled = true;
  subtitleBox.hidden = false;
  subtitleStatus.textContent = "분석 중";
  setStatus("선택한 쇼츠 구간의 음성을 분석합니다.");

  try {
    await loadFFmpeg();
    for (const name of ["input.mp4", "speech.wav"]) {
      try { await ffmpeg.deleteFile(name); } catch {}
    }
    setProgress(18, "음성 데이터를 추출하는 중...");
    const speechData = await extractSpeechAudio();
    const speechUrl = URL.createObjectURL(new Blob([speechData.buffer], { type: "audio/wav" }));
    const model = await loadWhisper();
    setProgress(35, "AI가 음성을 텍스트로 변환하는 중...");

    const language = subtitleLanguage.value;
    const options = {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      ...(language !== "auto" ? { language, task: "transcribe" } : {}),
    };
    const result = await model(speechUrl, options);
    URL.revokeObjectURL(speechUrl);

    subtitleSegments = (result.chunks || [])
      .map((chunk) => ({ start: Number(chunk.timestamp?.[0] ?? 0), end: Number(chunk.timestamp?.[1] ?? 0), text: String(chunk.text || "").trim() }))
      .filter((chunk) => chunk.text && chunk.end > chunk.start);

    renderSubtitleEditor();
    subtitleBox.hidden = false;
    subtitleStatus.textContent = subtitleSegments.length ? `${subtitleSegments.length}개 생성` : "음성 없음";
    setStage(2);
    setProgress(100, "자동 자막 생성 완료");
    setStatus(subtitleSegments.length ? "자동 자막이 생성되었습니다. 문구를 수정한 뒤 쇼츠 만들기를 누르세요." : "인식된 음성이 없습니다.");
  } catch (error) {
    console.error(error);
    subtitleStatus.textContent = "실패";
    setStatus("AI 자동 자막 생성에 실패했습니다.");
    setProgress(0, "자막 생성 실패");
  } finally {
    transcribeBtn.disabled = !videoFile;
    renderBtn.disabled = !videoFile;
  }
}

// 자막 렌더링용 폰트를 준비합니다.
async function ensureSubtitleFont() {
  if (subtitleFontLoaded) return;
  const response = await fetch("https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/KR/NotoSansKR-Regular.otf");
  if (!response.ok) throw new Error("subtitle font download failed");
  await ffmpeg.writeFile("NotoSansKR-Regular.otf", new Uint8Array(await response.arrayBuffer()));
  subtitleFontLoaded = true;
}

// 시간대별 자막 필터를 만듭니다.
function buildSubtitleFilters() {
  if (!subtitleSegments.length) return "";
  return subtitleSegments.filter((segment) => segment.text && segment.end > segment.start).map((segment) => {
    const text = escapeDrawText(wrapSubtitleText(segment.text));
    const start = Math.max(0, segment.start).toFixed(3);
    const end = Math.max(Number(start) + 0.05, segment.end).toFixed(3);
    return `drawtext=fontfile=NotoSansKR-Regular.otf:text='${text}':fontcolor=white:fontsize=58:borderw=5:bordercolor=black:x=(w-text_w)/2:y=h-300:enable='between(t,${start},${end})'`;
  }).join(",");
}

// 오디오의 에너지 피크를 찾아 비트 후보를 계산합니다.
async function detectBeats(file) {
  setProgress(12, "음악의 박자를 분석하는 중...");
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Web Audio API is not supported");

  const context = new AudioContextClass();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channelCount = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const channelData = [];
    for (let c = 0; c < channelCount; c++) channelData.push(buffer.getChannelData(c));

    const frameSize = 1024;
    const hop = 512;
    const energies = [];
    for (let offset = 0; offset + frameSize < buffer.length; offset += hop) {
      let sum = 0;
      for (let i = 0; i < frameSize; i += 4) {
        let sample = 0;
        for (let c = 0; c < channelCount; c++) sample += channelData[c][offset + i] || 0;
        sample /= channelCount;
        sum += sample * sample;
      }
      energies.push(Math.sqrt(sum / (frameSize / 4)));
    }

    const smooth = energies.map((value, i) => {
      const a = energies[Math.max(0, i - 2)];
      const b = energies[i];
      const c = energies[Math.min(energies.length - 1, i + 2)];
      return (a + b + c) / 3;
    });

    const mean = smooth.reduce((a, b) => a + b, 0) / Math.max(1, smooth.length);
    const variance = smooth.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, smooth.length);
    const threshold = mean + Math.sqrt(variance) * 0.55;
    const candidates = [];

    for (let i = 1; i < smooth.length - 1; i++) {
      if (smooth[i] < threshold || smooth[i] < smooth[i - 1] || smooth[i] < smooth[i + 1]) continue;
      const time = (i * hop) / sampleRate;
      const last = candidates[candidates.length - 1];
      if (!last || time - last > 0.22) candidates.push(time);
      else if (smooth[i] > last.energy) candidates[candidates.length - 1] = { time, energy: smooth[i] };
      else if (typeof last === "number") candidates[candidates.length - 1] = { time: last, energy: smooth[i] };
    }

    return candidates.map((item) => typeof item === "number" ? item : item.time);
  } finally {
    await context.close();
  }
}

// 선택한 구간을 비트 단위로 나눌 경계를 만듭니다.
function buildBeatSegments(beatTimes) {
  const target = getTargetDuration();
  const baseStart = getCutStart();
  const baseEnd = Math.min(sourceDuration, baseStart + target);
  if (!target || baseEnd <= baseStart) return [];

  const localBeats = beatTimes
    .filter((time) => time > 0.15 && time < target - 0.15)
    .map((time) => baseStart + time)
    .filter((time) => time > baseStart + 0.25 && time < baseEnd - 0.15);

  const boundaries = [baseStart, ...localBeats, baseEnd];
  const unique = [];
  for (const value of boundaries.sort((a, b) => a - b)) {
    if (!unique.length || value - unique[unique.length - 1] >= 0.18) unique.push(value);
  }

  // 지나치게 많은 컷은 렌더링 부담을 줄이기 위해 약 24개로 제한합니다.
  if (unique.length > 25) {
    const step = Math.ceil((unique.length - 1) / 24);
    const reduced = [unique[0]];
    for (let i = step; i < unique.length - 1; i += step) reduced.push(unique[i]);
    reduced.push(unique[unique.length - 1]);
    return reduced;
  }

  return unique;
}

// 비트 기반 편집에 사용할 원본 구간을 분석합니다.
async function prepareBeatEdit() {
  if (!beatEdit.checked) return [];
  if (!audioFile && !videoFile) return [];

  const analysisFile = audioFile || videoFile;
  const beats = await detectBeats(analysisFile);
  beatCuts = buildBeatSegments(beats);

  if (beatCuts.length < 2) {
    throw new Error("beat points not found");
  }

  setProgress(20, `${beatCuts.length - 1}개 구간을 비트에 맞춰 편집합니다.`);
  return beatCuts;
}

// 비트 구간을 FFmpeg filter_complex concat으로 하나의 영상으로 만듭니다.
function buildBeatFilterComplex(segments, videoFilter) {
  const parts = [];
  const labels = [];

  for (let i = 0; i < segments.length - 1; i++) {
    const start = segments[i].toFixed(3);
    const end = segments[i + 1].toFixed(3);
    const label = `b${i}`;
    labels.push(`[${label}]`);
    parts.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,${videoFilter}[${label}]`);
  }

  parts.push(`${labels.join("")}concat=n=${labels.length}:v=1:a=0[beatv]`);
  return parts.join(";");
}

// FFmpeg로 최종 쇼츠를 렌더링합니다.
async function renderShorts() {
  if (!videoFile) return;

  renderBtn.disabled = true;
  transcribeBtn.disabled = true;
  downloadBtn.hidden = true;
  setStatus("렌더링을 시작합니다.");

  try {
    await loadFFmpeg();
    attachProgressListener();

    for (const name of ["input.mp4", "music", "output.mp4", "NotoSansKR-Regular.otf"]) {
      if (name === "NotoSansKR-Regular.otf" && subtitleFontLoaded) continue;
      try { await ffmpeg.deleteFile(name); } catch {}
    }

    await ffmpeg.writeFile("input.mp4", await fetchFile(videoFile));
    if (audioFile) await ffmpeg.writeFile("music", await fetchFile(audioFile));

    if (subtitleSegments.length) {
      setProgress(15, "자막 폰트를 준비하는 중...");
      await ensureSubtitleFont();
    }

    let beatSegments = [];
    if (beatEdit.checked) {
      beatSegments = await prepareBeatEdit();
      setStage(3);
    }

    const targetDuration = getTargetDuration();
    const cutStart = getCutStart();
    const text = overlayText.value.trim();
    const baseFilter = buildCropFilter();

    // 비트 편집은 먼저 영상 조각을 이어 붙인 뒤 자막과 문구를 적용합니다.
    let args;
    if (beatSegments.length > 1) {
      const filters = [];
      const concatFilter = buildBeatFilterComplex(beatSegments, baseFilter);
      filters.push(concatFilter);

      let current = "[beatv]";
      if (text) {
        await ensureSubtitleFont();
        filters.push(`[beatv]drawtext=fontfile=NotoSansKR-Regular.otf:text='${escapeDrawText(text)}':fontcolor=white:fontsize=54:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h-260[captionv]`);
        current = "[captionv]";
      }
      if (subtitleSegments.length) {
        await ensureSubtitleFont();
        const subtitleChain = buildSubtitleFilters();
        filters.push(`${current}${subtitleChain ? "," + subtitleChain : ""}[finalv]`);
        current = "[finalv]";
      }

      args = ["-i", "input.mp4", "-filter_complex", filters.join(";"), "-map", current, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
    } else {
      const filters = [baseFilter];
      if (text) {
        await ensureSubtitleFont();
        filters.push(`drawtext=fontfile=NotoSansKR-Regular.otf:text='${escapeDrawText(text)}':fontcolor=white:fontsize=54:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h-260`);
      }
      if (subtitleSegments.length) {
        await ensureSubtitleFont();
        filters.push(buildSubtitleFilters());
      }
      args = ["-ss", String(cutStart), "-i", "input.mp4", "-vf", filters.filter(Boolean).join(","), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
    }

    if (audioFile) {
      args.push("-stream_loop", "-1", "-i", "music", "-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-b:a", "192k");
    } else {
      args.push("-map", "0:v:0", "-map", "0:a:0?", "-c:a", "aac", "-b:a", "128k");
    }

    if (targetDuration > 0) args.push("-t", String(targetDuration));
    args.push("-movflags", "+faststart", "-y", "output.mp4");

    setProgress(25, beatSegments.length > 1 ? "비트에 맞춰 컷을 이어 붙이는 중..." : "9:16 변환, 자동 컷, 음악, 자막을 적용하는 중...");
    await ffmpeg.exec(args);

    setProgress(96, "완성 파일을 준비하는 중...");
    const data = await ffmpeg.readFile("output.mp4");
    if (outputObjectUrl) URL.revokeObjectURL(outputObjectUrl);
    outputObjectUrl = URL.createObjectURL(new Blob([data.buffer], { type: "video/mp4" }));

    previewVideo.src = outputObjectUrl;
    previewVideo.load();
    downloadBtn.href = outputObjectUrl;
    downloadBtn.download = "flick-shorts.mp4";
    downloadBtn.hidden = false;

    setProgress(100, "완성되었습니다.");
    setStatus(beatSegments.length > 1 ? "비트 기반 자동 편집이 적용된 쇼츠가 완성되었습니다." : "쇼츠가 완성되었습니다.");
  } catch (error) {
    console.error(error);
    setStatus(beatEdit.checked ? "비트 분석 또는 렌더링에 실패했습니다. 음악 파일 형식과 브라우저 메모리를 확인해주세요." : "렌더링에 실패했습니다. 브라우저 메모리나 입력 파일 형식을 확인해주세요.");
    setProgress(0, "렌더링 실패");
  } finally {
    renderBtn.disabled = !videoFile;
    transcribeBtn.disabled = !videoFile;
  }
}

// 드래그 앤 드롭 입력을 처리합니다.
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  setVideo(event.dataTransfer.files[0]);
});

// 파일 입력 이벤트를 연결합니다.
videoInput.addEventListener("change", () => setVideo(videoInput.files[0]));
audioInput.addEventListener("change", () => setAudio(audioInput.files[0]));
overlayText.addEventListener("input", updateOverlay);
transcribeBtn.addEventListener("click", generateSubtitles);
renderBtn.addEventListener("click", renderShorts);
beatEdit.addEventListener("change", () => {
  if (beatEdit.checked) setStatus("비트 기반 편집이 켜졌습니다. 배경음악이 없으면 영상 원본 오디오를 분석합니다.");
  else setStatus("비트 기반 편집을 끄고 일반 자동 컷을 사용합니다.");
});

// 배경음악 파일을 선택합니다.
function setAudio(file) {
  if (!file || !file.type.startsWith("audio/")) {
    setStatus("오디오 파일만 선택할 수 있습니다.");
    return;
  }
  audioFile = file;
  audioName.textContent = file.name;
  clearAudio.hidden = false;
  setStatus("배경음악이 선택되었습니다.");
}
audioInput.addEventListener("change", () => setAudio(audioInput.files[0]));

clearAudio.addEventListener("click", () => {
  audioFile = null;
  audioInput.value = "";
  audioName.textContent = "선택하지 않음";
  clearAudio.hidden = true;
});

// 영상을 제거합니다.
removeVideo.addEventListener("click", () => {
  videoFile = null;
  audioFile = null;
  sourceDuration = 0;
  subtitleSegments = [];
  beatCuts = [];
  videoInput.value = "";
  audioInput.value = "";
  fileInfo.hidden = true;
  subtitleBox.hidden = true;
  subtitleList.innerHTML = "";
  previewVideo.removeAttribute("src");
  previewVideo.load();
  previewVideo.hidden = true;
  emptyPreview.hidden = false;
  renderBtn.disabled = true;
  transcribeBtn.disabled = true;
  audioName.textContent = "선택하지 않음";
  clearAudio.hidden = true;
  setStage(0);
  setStatus("영상을 선택해주세요.");
});

// 상단 버튼을 편집기로 부드럽게 이동합니다.
document.querySelectorAll("[data-scroll]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.querySelector(button.dataset.scroll);
    if (target) target.scrollIntoView({ behavior: "smooth" });
  });
});
