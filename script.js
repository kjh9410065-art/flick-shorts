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
const voiceText = document.getElementById("voiceText");
const voiceLanguage = document.getElementById("voiceLanguage");
const voiceSpeaker = document.getElementById("voiceSpeaker");
const voiceSpeed = document.getElementById("voiceSpeed");
const voiceSpeedValue = document.getElementById("voiceSpeedValue");
const voiceMix = document.getElementById("voiceMix");
const generateVoiceBtn = document.getElementById("generateVoiceBtn");
const clearVoice = document.getElementById("clearVoice");
const voiceStatus = document.getElementById("voiceStatus");
const voicePreview = document.getElementById("voicePreview");
const imagePrompt = document.getElementById("imagePrompt");
const imageModel = document.getElementById("imageModel");
const imageSize = document.getElementById("imageSize");
const imageApiKey = document.getElementById("imageApiKey");
const saveImageKey = document.getElementById("saveImageKey");
const generateImageBtn = document.getElementById("generateImageBtn");
const clearImage = document.getElementById("clearImage");
const imageStatus = document.getElementById("imageStatus");
const imageResult = document.getElementById("imageResult");
const generatedImage = document.getElementById("generatedImage");
const downloadImageBtn = document.getElementById("downloadImageBtn");
const videoAiPrompt = document.getElementById("videoAiPrompt");
const videoAiModel = document.getElementById("videoAiModel");
const videoAiDuration = document.getElementById("videoAiDuration");
const videoAiApiKey = document.getElementById("videoAiApiKey");
const saveVideoAiKey = document.getElementById("saveVideoAiKey");
const generateVideoAiBtn = document.getElementById("generateVideoAiBtn");
const clearVideoAi = document.getElementById("clearVideoAi");
const videoAiStatus = document.getElementById("videoAiStatus");
const videoAiResult = document.getElementById("videoAiResult");
const generatedAiVideo = document.getElementById("generatedAiVideo");
const downloadAiVideoBtn = document.getElementById("downloadAiVideoBtn");
const aiToolsToggle = document.getElementById("aiToolsToggle");
const aiToolsContent = document.getElementById("aiToolsContent");

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
let ttsSynthesizer = null;
let ttsModelLoaded = false;
let voiceBlob = null;
let voiceObjectUrl = null;

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

// 영상 파일을 선택하고 메타데이터를 읽습니다.
function setVideo(file) {
  if (!file || !file.type.startsWith("video/")) {
    setStatus("영상 파일만 선택할 수 있습니다.");
    return;
  }

  videoFile = file;
  document.querySelector(".editor-card")?.classList.add("has-video");
  document.querySelector(".preview-head b")?.replaceChildren(document.createTextNode("원본 미리보기"));
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
    setStatus("영상이 준비되었습니다. 쇼츠 만들기를 눌러 자동 생성하세요.");
  };
  probe.onerror = () => {
    URL.revokeObjectURL(metadataUrl);
    renderBtn.disabled = false;
    transcribeBtn.disabled = false;
    setStatus("영상이 준비되었습니다. 쇼츠 만들기를 눌러 자동 생성하세요.");
  };
  probe.src = metadataUrl;
  updateOverlay();
}

// 선택한 쇼츠 길이를 계산합니다.
function getTargetDuration() {
  const requested = Number(durationSelect.value);
  if (!sourceDuration) return 0;
  if (requested === 0) return Math.min(30, sourceDuration);
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
async function generateSubtitles(options = {}) {
  if (!videoFile) return;
  const silent = Boolean(options.silent);
  transcribeBtn.disabled = true;
  renderBtn.disabled = true;
  subtitleBox.hidden = false;
  subtitleStatus.textContent = "분석 중";
  if (!silent) setStatus("음성을 분석하는 중입니다.");

  try {
    await loadFFmpeg();
    for (const name of ["input.mp4", "speech.wav"]) {
      try { await ffmpeg.deleteFile(name); } catch {}
    }
    setProgress(18, "음성을 확인하는 중입니다...");
    const speechData = await extractSpeechAudio();
    const speechUrl = URL.createObjectURL(new Blob([speechData.buffer], { type: "audio/wav" }));
    const model = await loadWhisper();
    setProgress(35, "자동 자막을 만드는 중...");

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
    if (!silent) {
      setProgress(100, "자동 자막 생성 완료");
      setStatus(subtitleSegments.length ? "자동 자막이 생성되었습니다." : "인식된 음성이 없습니다.");
    }
  } catch (error) {
    console.error(error);
    subtitleStatus.textContent = silent ? "음성 없음" : "실패";
    if (!silent) {
      setStatus("AI 자동 자막 생성에 실패했습니다.");
      setProgress(0, "자막 생성 실패");
    }
    if (silent) subtitleSegments = [];
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


// Supertonic TTS 모델을 브라우저에서 최초 한 번만 로드합니다.
async function loadTTS() {
  if (ttsSynthesizer) return ttsSynthesizer;
  setProgress(8, "AI 음성 모델을 불러오는 중...");
  const { pipeline } = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1");
  ttsSynthesizer = await pipeline("text-to-speech", "onnx-community/Supertonic-TTS-2-ONNX");
  ttsModelLoaded = true;
  return ttsSynthesizer;
}

// 입력 언어를 Supertonic이 요구하는 언어 태그로 감쌉니다.
function wrapTTSLanguage(text, language) {
  return "<" + language + ">" + text.replace(/\s+/g, " ").trim() + "</" + language + ">";
}

// AI 음성을 생성하고 미리보기 오디오를 준비합니다.
async function generateVoice() {
  const text = voiceText.value.replace(/\s+/g, " ").trim();
  if (!text) {
    voiceStatus.textContent = "텍스트 필요";
    setStatus("AI 음성으로 만들 문장을 입력해주세요.");
    voiceText.focus();
    return;
  }

  generateVoiceBtn.disabled = true;
  clearVoice.hidden = true;
  voiceStatus.textContent = "생성 중";
  setStatus("AI 음성을 생성하는 중입니다. 첫 생성은 모델 다운로드가 필요합니다.");

  try {
    const synthesizer = await loadTTS();
    setProgress(25, "AI가 음성을 합성하는 중...");
    const output = await synthesizer(wrapTTSLanguage(text, voiceLanguage.value), {
      speaker_embeddings: "https://huggingface.co/onnx-community/Supertonic-TTS-2-ONNX/resolve/main/voices/" + voiceSpeaker.value + ".bin",
      num_inference_steps: 5,
      speed: Number(voiceSpeed.value)
    });

    voiceBlob = typeof output.toBlob === "function"
      ? output.toBlob()
      : new Blob([createWavBuffer(output.audio, output.sampling_rate)], { type: "audio/wav" });

    if (voiceObjectUrl) URL.revokeObjectURL(voiceObjectUrl);
    voiceObjectUrl = URL.createObjectURL(voiceBlob);
    voicePreview.src = voiceObjectUrl;
    voicePreview.hidden = false;
    clearVoice.hidden = false;
    voiceStatus.textContent = "생성 완료";
    setProgress(100, "AI 음성 생성 완료");
    setStatus("AI 음성이 생성되었습니다. 미리 들어보고 쇼츠 만들기를 누르세요.");
  } catch (error) {
    console.error(error);
    voiceBlob = null;
    voiceStatus.textContent = "실패";
    setStatus("AI 음성 생성에 실패했습니다. 브라우저 메모리와 네트워크 상태를 확인해주세요.");
    setProgress(0, "AI 음성 생성 실패");
  } finally {
    generateVoiceBtn.disabled = false;
  }
}

// Raw Float32 오디오를 WAV 파일로 변환합니다.
function createWavBuffer(samples, sampleRate) {
  const data = samples instanceof Float32Array ? samples : new Float32Array(samples);
  const buffer = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + data.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return buffer;
}

// 생성된 AI 음성을 제거합니다.
function clearGeneratedVoice() {
  voiceBlob = null;
  if (voiceObjectUrl) URL.revokeObjectURL(voiceObjectUrl);
  voiceObjectUrl = null;
  voicePreview.removeAttribute("src");
  voicePreview.load();
  voicePreview.hidden = true;
  clearVoice.hidden = true;
  voiceStatus.textContent = "텍스트를 입력하세요";
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


// 현재 필터 구성에 맞는 비디오 출력 라벨을 찾습니다.
function getVideoMap(args) {
  const index = args.indexOf("-filter_complex");
  if (index >= 0) {
    const filter = args[index + 1] || "";
    if (filter.includes("[finalv]")) return "[finalv]";
    if (filter.includes("[captionv]")) return "[captionv]";
    if (filter.includes("[beatv]")) return "[beatv]";
  }
  return "0:v:0";
}

// 기존 filter_complex가 있으면 오디오 필터를 같은 그래프에 이어 붙입니다.
function addAudioFilter(args, audioFilter) {
  const index = args.indexOf("-filter_complex");
  if (index >= 0) {
    args[index + 1] = args[index + 1] + ";" + audioFilter;
  } else {
    args.push("-filter_complex", audioFilter);
  }
}


// 이미지 생성 API 키를 브라우저 로컬 저장소에서 불러옵니다.
function loadImageApiKey() {
  const key = localStorage.getItem("flickShortsImageApiKey") || "";
  imageApiKey.value = key;
}

// 이미지 생성 API 키를 이 브라우저에만 저장합니다.
function saveImageApiKey() {
  const key = imageApiKey.value.trim();
  if (!key) {
    localStorage.removeItem("flickShortsImageApiKey");
    imageStatus.textContent = "키 삭제됨";
    return;
  }
  localStorage.setItem("flickShortsImageApiKey", key);
  imageStatus.textContent = "키 저장됨";
}

// Pollinations 이미지 API로 쇼츠용 이미지를 생성합니다.
async function generateImage() {
  const prompt = imagePrompt.value.trim();
  const key = imageApiKey.value.trim() || localStorage.getItem("flickShortsImageApiKey") || "";
  if (!prompt) {
    imageStatus.textContent = "프롬프트 필요";
    setStatus("생성할 이미지의 설명을 입력해주세요.");
    imagePrompt.focus();
    return;
  }
  if (!key) {
    imageStatus.textContent = "API 키 필요";
    setStatus("이미지 생성 API 키를 입력해주세요.");
    imageApiKey.focus();
    return;
  }

  generateImageBtn.disabled = true;
  clearImage.hidden = true;
  imageStatus.textContent = "생성 중";
  setProgress(15, "AI 이미지를 생성하는 중...");

  try {
    const [width, height] = imageSize.value.split("x").map(Number);
    const url = "https://gen.pollinations.ai/image/" + encodeURIComponent(prompt) +
      "?model=" + encodeURIComponent(imageModel.value) +
      "&width=" + width + "&height=" + height +
      "&nologo=true";

    const response = await fetch(url, {
      headers: { Authorization: "Bearer " + key }
    });
    if (!response.ok) throw new Error("image generation failed: " + response.status);

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    generatedImage.src = objectUrl;
    generatedImage.dataset.objectUrl = objectUrl;
    imageResult.hidden = false;
    clearImage.hidden = false;
    downloadImageBtn.href = objectUrl;
    downloadImageBtn.download = "flick-shorts-ai-image.png";
    downloadImageBtn.hidden = false;

    imageStatus.textContent = "생성 완료";
    setProgress(100, "AI 이미지 생성 완료");
    setStatus("AI 이미지가 생성되었습니다.");
  } catch (error) {
    console.error(error);
    imageStatus.textContent = "실패";
    setStatus("AI 이미지 생성에 실패했습니다. API 키와 서비스 한도를 확인해주세요.");
    setProgress(0, "이미지 생성 실패");
  } finally {
    generateImageBtn.disabled = false;
  }
}

// 현재 생성된 이미지를 제거합니다.
function clearGeneratedImage() {
  const oldUrl = generatedImage.dataset.objectUrl;
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  generatedImage.removeAttribute("src");
  generatedImage.dataset.objectUrl = "";
  imageResult.hidden = true;
  downloadImageBtn.hidden = true;
  clearImage.hidden = true;
  imageStatus.textContent = "준비됨";
}


// AI 영상 API 키를 브라우저 로컬 저장소에서 불러옵니다.
function loadVideoAiApiKey() {
  videoAiApiKey.value = localStorage.getItem("flickShortsVideoAiApiKey") || "";
}

// AI 영상 API 키를 이 브라우저에만 저장합니다.
function saveVideoAiApiKeyValue() {
  const key = videoAiApiKey.value.trim();
  if (key) localStorage.setItem("flickShortsVideoAiApiKey", key);
  else localStorage.removeItem("flickShortsVideoAiApiKey");
  videoAiStatus.textContent = key ? "키 저장됨" : "키 삭제됨";
}

// Luma Dream Machine 호환 REST API로 영상 생성 작업을 시작합니다.
async function generateAiVideo() {
  const prompt = videoAiPrompt.value.trim();
  const key = videoAiApiKey.value.trim() || localStorage.getItem("flickShortsVideoAiApiKey") || "";
  if (!prompt) {
    videoAiStatus.textContent = "프롬프트 필요";
    setStatus("AI 영상으로 만들 장면을 입력해주세요.");
    videoAiPrompt.focus();
    return;
  }
  if (!key) {
    videoAiStatus.textContent = "API 키 필요";
    setStatus("AI 영상 API 키를 입력해주세요.");
    videoAiApiKey.focus();
    return;
  }

  generateVideoAiBtn.disabled = true;
  clearVideoAi.hidden = true;
  videoAiStatus.textContent = "생성 요청 중";
  setProgress(10, "AI 영상 생성을 요청하는 중...");

  try {
    // Luma API의 text-to-video 요청을 생성합니다.
    const createResponse = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key
      },
      body: JSON.stringify({
        prompt,
        model: videoAiModel.value === "wan" ? "ray-2" : "ray-2",
        aspect_ratio: "9:16",
        duration: videoAiDuration.value
      })
    });

    if (!createResponse.ok) throw new Error("video generation request failed: " + createResponse.status);
    const created = await createResponse.json();
    const generationId = created.id;
    if (!generationId) throw new Error("generation id missing");

    // 생성 완료까지 일정 간격으로 상태를 확인합니다.
    let result = created;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (result.state === "completed" || result.status === "completed") break;
      if (result.state === "failed" || result.status === "failed") throw new Error("generation failed");
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const pollResponse = await fetch("https://api.lumalabs.ai/dream-machine/v1/generations/" + encodeURIComponent(generationId), {
        headers: { "Authorization": "Bearer " + key }
      });
      if (!pollResponse.ok) throw new Error("generation polling failed: " + pollResponse.status);
      result = await pollResponse.json();
      setProgress(10 + Math.min(80, (attempt + 1) * 1.4), "AI 영상 생성 중...");
    }

    const videoUrl = result.assets?.video;
    if (!videoUrl) throw new Error("video url missing");

    generatedAiVideo.src = videoUrl;
    generatedAiVideo.load();
    videoAiResult.hidden = false;
    clearVideoAi.hidden = false;
    downloadAiVideoBtn.href = videoUrl;
    downloadAiVideoBtn.download = "flick-shorts-ai-video.mp4";
    downloadAiVideoBtn.hidden = false;

    videoAiStatus.textContent = "생성 완료";
    setProgress(100, "AI 영상 생성 완료");
    setStatus("AI 영상이 생성되었습니다.");
  } catch (error) {
    console.error(error);
    videoAiStatus.textContent = "실패";
    setStatus("AI 영상 생성에 실패했습니다. API 키, 모델 사용 권한, API 한도를 확인해주세요.");
    setProgress(0, "AI 영상 생성 실패");
  } finally {
    generateVideoAiBtn.disabled = false;
  }
}

// 생성된 AI 영상을 제거합니다.
function clearGeneratedAiVideo() {
  generatedAiVideo.pause();
  generatedAiVideo.removeAttribute("src");
  generatedAiVideo.load();
  videoAiResult.hidden = true;
  downloadAiVideoBtn.hidden = true;
  clearVideoAi.hidden = true;
  videoAiStatus.textContent = "준비됨";
}

// FFmpeg로 최종 쇼츠를 렌더링합니다.
async function renderShorts() {
  if (!videoFile) return;

  renderBtn.disabled = true;
  transcribeBtn.disabled = true;
  generateVoiceBtn.disabled = true;
  downloadBtn.hidden = true;
  setStatus("쇼츠를 만드는 중입니다.");

  try {
    await loadFFmpeg();
    attachProgressListener();

    for (const name of ["input.mp4", "music", "voice.wav", "output.mp4", "NotoSansKR-Regular.otf"]) {
      if (name === "NotoSansKR-Regular.otf" && subtitleFontLoaded) continue;
      try { await ffmpeg.deleteFile(name); } catch {}
    }

    setProgress(12, "영상 분석 중...");
    await ffmpeg.writeFile("input.mp4", await fetchFile(videoFile));
    if (audioFile) await ffmpeg.writeFile("music", await fetchFile(audioFile));

    // 사용자가 별도로 자막 생성을 누르지 않아도 음성이 있으면 자동으로 자막을 만듭니다.
    if (!subtitleSegments.length) {
      setProgress(18, "자동 자막 생성 중...");
      await generateSubtitles({ silent: true });
    }

    if (subtitleSegments.length) {
      setProgress(22, "자동 자막을 영상에 적용하는 중...");
      await ensureSubtitleFont();
    }

    let beatSegments = [];
    if (beatEdit.checked) {
      beatSegments = await prepareBeatEdit();
    }

    const targetDuration = getTargetDuration();
    const cutStart = getCutStart();
    const text = overlayText.value.trim();
    const baseFilter = buildCropFilter();
    if (voiceBlob) {
      setProgress(18, "AI 음성 파일을 준비하는 중...");
      await ffmpeg.writeFile("voice.wav", new Uint8Array(await voiceBlob.arrayBuffer()));
    }

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

    // AI 음성이 있으면 음성·배경음악·원본 오디오 중 선택한 소스를 합성합니다.
    if (voiceBlob) {
      if (audioFile) {
        args.push("-stream_loop", "-1", "-i", "music", "-i", "voice.wav");
        if (voiceMix.value === "music") {
          addAudioFilter(args, "[1:a]volume=0.35[musicv];[musicv][2:a]amix=inputs=2:duration=longest:dropout_transition=2[aout]");
        } else if (voiceMix.value === "original") {
          addAudioFilter(args, "[0:a]volume=0.25[originalv];[originalv][2:a]amix=inputs=2:duration=longest:dropout_transition=2[aout]");
        } else {
          addAudioFilter(args, "[2:a]apad[aout]");
        }
        args.push("-map", getVideoMap(args), "-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
      } else {
        args.push("-i", "voice.wav");
        if (voiceMix.value === "original") {
          addAudioFilter(args, "[0:a]volume=0.25[originalv];[originalv][1:a]amix=inputs=2:duration=longest:dropout_transition=2[aout]");
        } else {
          addAudioFilter(args, "[1:a]apad[aout]");
        }
        args.push("-map", getVideoMap(args), "-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
      }
    } else if (audioFile) {
      args.push("-stream_loop", "-1", "-i", "music", "-map", getVideoMap(args), "-map", "1:a:0", "-c:a", "aac", "-b:a", "192k");
    } else {
      args.push("-map", getVideoMap(args), "-map", "0:a:0?", "-c:a", "aac", "-b:a", "128k");
    }

    if (targetDuration > 0) args.push("-t", String(targetDuration));
    args.push("-movflags", "+faststart", "-y", "output.mp4");

    setProgress(25, beatSegments.length > 1 ? "음악에 맞춰 영상을 편집하는 중..." : "9:16 세로 영상으로 변환하고 렌더링하는 중...");
    await ffmpeg.exec(args);

    setProgress(96, "완성 파일을 준비하는 중...");
    const data = await ffmpeg.readFile("output.mp4");
    if (outputObjectUrl) URL.revokeObjectURL(outputObjectUrl);
    outputObjectUrl = URL.createObjectURL(new Blob([data.buffer], { type: "video/mp4" }));

    previewVideo.src = outputObjectUrl;
    previewVideo.load();
    document.querySelector(".preview-head b")?.replaceChildren(document.createTextNode("완성된 쇼츠"));
    downloadBtn.href = outputObjectUrl;
    downloadBtn.download = "flick-shorts.mp4";
    downloadBtn.hidden = false;
    document.getElementById("resetResultBtn")?.removeAttribute("hidden");

    setProgress(100, "완성되었습니다.");
    setStatus(beatSegments.length > 1 ? "비트 기반 자동 편집이 적용된 쇼츠가 완성되었습니다." : "쇼츠가 완성되었습니다.");
  } catch (error) {
    console.error(error);
    setStatus(beatEdit.checked ? "비트 분석 또는 렌더링에 실패했습니다. 음악 파일 형식과 브라우저 메모리를 확인해주세요." : "렌더링에 실패했습니다. 브라우저 메모리나 입력 파일 형식을 확인해주세요.");
    setProgress(0, "렌더링 실패");
  } finally {
    renderBtn.disabled = !videoFile;
    transcribeBtn.disabled = !videoFile;
    generateVoiceBtn.disabled = false;
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
generateVoiceBtn.addEventListener("click", generateVoice);
clearVoice.addEventListener("click", clearGeneratedVoice);
voiceText.addEventListener("input", () => {
  voiceStatus.textContent = voiceText.value.trim() ? "생성 가능" : "텍스트를 입력하세요";
});
voiceSpeed.addEventListener("input", () => {
  voiceSpeedValue.textContent = Number(voiceSpeed.value).toFixed(2) + "x";
});
voiceLanguage.addEventListener("change", () => {
  clearGeneratedVoice();
  voiceStatus.textContent = "언어 변경됨 · 다시 생성하세요";
});
voiceSpeaker.addEventListener("change", () => {
  clearGeneratedVoice();
  voiceStatus.textContent = "목소리 변경됨 · 다시 생성하세요";
});
voiceSpeed.addEventListener("change", clearGeneratedVoice);
saveImageKey.addEventListener("click", saveImageApiKey);
generateImageBtn.addEventListener("click", generateImage);
clearImage.addEventListener("click", clearGeneratedImage);
imagePrompt.addEventListener("input", () => {
  if (imagePrompt.value.trim()) imageStatus.textContent = "생성 가능";
});
loadImageApiKey();
loadVideoAiApiKey();
if (aiToolsToggle && aiToolsContent) {
  // AI 소재 생성 메뉴는 기본적으로 접어 두어 메인 쇼츠 제작 화면을 깔끔하게 유지합니다.
  aiToolsToggle.addEventListener("click", () => {
    const opened = aiToolsContent.classList.toggle("open");
    aiToolsToggle.classList.toggle("open", opened);
    aiToolsToggle.querySelector("span").textContent = opened ? "－" : "＋";
  });
}
saveVideoAiKey.addEventListener("click", saveVideoAiApiKeyValue);
generateVideoAiBtn.addEventListener("click", generateAiVideo);
clearVideoAi.addEventListener("click", clearGeneratedAiVideo);
renderBtn.addEventListener("click", renderShorts);
document.getElementById("resetResultBtn")?.addEventListener("click", () => {
  if (outputObjectUrl) URL.revokeObjectURL(outputObjectUrl);
  outputObjectUrl = null;
  downloadBtn.hidden = true;
  document.getElementById("resetResultBtn").hidden = true;
  previewVideo.src = videoObjectUrl || "";
  previewVideo.load();
  document.querySelector(".preview-head b")?.replaceChildren(document.createTextNode("원본 미리보기"));
  setStatus("영상이 준비되었습니다. 쇼츠 만들기를 눌러 자동 생성하세요.");
});
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


clearAudio.addEventListener("click", () => {
  audioFile = null;
  audioInput.value = "";
  audioName.textContent = "선택하지 않음";
  clearAudio.hidden = true;
});

// 영상을 제거합니다.
removeVideo.addEventListener("click", () => {
  videoFile = null;
  document.querySelector(".editor-card")?.classList.remove("has-video");
  document.querySelector(".preview-head b")?.replaceChildren(document.createTextNode("미리보기"));
  audioFile = null;
  sourceDuration = 0;
  subtitleSegments = [];
  beatCuts = [];
  clearGeneratedVoice();
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
  setStatus("영상을 선택해주세요.");
});

// 상단 버튼을 편집기로 부드럽게 이동합니다.
function showEditorTab(tab, pushHistory = true) {
  const editor = document.querySelector("#editor");
  const extra = document.querySelector("#extraFeaturesPage");
  const autoTab = document.querySelector("#shortsAutoTab");
  const extraTab = document.querySelector("#extraFeaturesTab");
  if (!editor || !extra || !autoTab || !extraTab) return;

  const showExtra = tab === "extra";
  editor.hidden = showExtra;
  extra.hidden = !showExtra;
  autoTab.classList.toggle("active", !showExtra);
  extraTab.classList.toggle("active", showExtra);
  autoTab.setAttribute("aria-selected", String(!showExtra));
  extraTab.setAttribute("aria-selected", String(showExtra));
  window.scrollTo({ top: 0, behavior: "instant" });

  if (pushHistory) history.pushState({ page: showExtra ? "extra" : "editor" }, "", showExtra ? "#extra" : "#editor");
}

function openEditor(pushHistory = true) {
  const hero = document.querySelector(".hero");
  const editor = document.querySelector("#editor");
  const roadmap = document.querySelector("#roadmap");
  const nav = document.querySelector("#siteNav");
  const tabs = document.querySelector("#appTabs");
  if (!editor) return;
  hero?.classList.add("page-hidden");
  if (roadmap) roadmap.hidden = true;
  if (nav) nav.classList.add("visible");
  if (tabs) tabs.hidden = false;
  document.body.classList.add("editor-open");
  showEditorTab("auto", false);
  if (pushHistory) history.pushState({ page: "editor" }, "", "#editor");
}

function showLanding(pushHistory = true) {
  const hero = document.querySelector(".hero");
  const editor = document.querySelector("#editor");
  const extra = document.querySelector("#extraFeaturesPage");
  const roadmap = document.querySelector("#roadmap");
  const nav = document.querySelector("#siteNav");
  const tabs = document.querySelector("#appTabs");
  hero?.classList.remove("page-hidden");
  if (editor) editor.hidden = true;
  if (extra) extra.hidden = true;
  if (roadmap) roadmap.hidden = true;
  if (tabs) tabs.hidden = true;
  nav?.classList.remove("visible");
  document.body.classList.remove("editor-open");
  if (pushHistory) history.pushState({ page: "landing" }, "", window.location.pathname);
  window.scrollTo({ top: 0, behavior: "instant" });
}

document.querySelectorAll("[data-scroll]").forEach((button) => {
  button.addEventListener("click", () => {
    const selector = button.dataset.scroll;
    if (selector === "#editor") {
      openEditor();
      return;
    }
    const target = document.querySelector(selector);
    if (target) target.scrollIntoView({ behavior: "smooth" });
  });
});

document.querySelectorAll("[data-tool-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    const index = tab.dataset.toolTab;
    document.querySelectorAll("[data-tool-tab]").forEach((item) => {
      const active = item.dataset.toolTab === index;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-tool-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.toolPanel !== index;
      panel.classList.toggle("active", panel.dataset.toolPanel === index);
    });
  });
});

document.querySelector("#shortsAutoTab")?.addEventListener("click", () => showEditorTab("auto"));
document.querySelector("#extraFeaturesTab")?.addEventListener("click", () => showEditorTab("extra"));

const brandButton = document.querySelector(".brand");
if (brandButton) {
  brandButton.addEventListener("click", (event) => {
    event.preventDefault();
    showLanding();
  });
}

window.addEventListener("popstate", () => {
  if (window.location.hash === "#extra") {
    openEditor(false);
    showEditorTab("extra", false);
  } else if (window.location.hash === "#editor") {
    openEditor(false);
  } else {
    showLanding(false);
  }
});

if (window.location.hash === "#extra") {
  openEditor(false);
  showEditorTab("extra", false);
} else if (window.location.hash === "#editor") {
  openEditor(false);
}
