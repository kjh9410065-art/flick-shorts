// FLiCK Shorts의 브라우저 기반 MVP를 제어합니다.
// 실제 영상 처리는 FFmpeg WebAssembly를 사용하므로 서버 없이 기본 편집을 시험할 수 있습니다.

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
const durationSelect = document.getElementById("duration");
const positionSelect = document.getElementById("position");
const cutModeSelect = document.getElementById("cutMode");
const previewMeta = document.getElementById("previewMeta");
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

const ffmpeg = new FFmpeg();
let videoFile = null;
let audioFile = null;
let videoObjectUrl = null;
let outputObjectUrl = null;
let ffmpegLoaded = false;
let sourceDuration = 0;
let progressListenerAttached = false;

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

// 영상 파일을 선택하면 미리보기와 기본 정보를 갱신합니다.
function setVideo(file) {
  if (!file || !file.type.startsWith("video/")) {
    setStatus("영상 파일만 선택할 수 있습니다.");
    return;
  }

  videoFile = file;
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
    updatePreviewInfo();
    setStatus("영상이 준비되었습니다. 자동 컷 구간을 계산할 수 있습니다.");
  };
  probe.onerror = () => {
    URL.revokeObjectURL(metadataUrl);
    renderBtn.disabled = false;
    setStatus("영상이 준비되었습니다. 옵션을 선택하고 쇼츠 만들기를 눌러주세요.");
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

// 자동 컷에 사용할 시작 시점을 계산합니다.
function getCutStart() {
  const target = getTargetDuration();
  const available = Math.max(0, sourceDuration - target);
  if (!available) return 0;
  if (cutModeSelect.value === "start") return 0;
  if (cutModeSelect.value === "end") return available;
  return available / 2;
}

// 현재 선택된 구간을 미리보기 정보에 표시합니다.
function updatePreviewInfo() {
  if (!videoFile || !previewMeta) return;
  const target = getTargetDuration();
  const start = getCutStart();
  previewMeta.textContent = `원본 ${sourceDuration.toFixed(1)}초 · ${start.toFixed(1)}~${(start + target).toFixed(1)}초 · 9:16`;
}

// 배경음악 파일을 선택하면 이름을 표시합니다.
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

// 영상의 비율을 유지하면서 9:16 화면 중앙 또는 좌우 기준으로 크롭합니다.
function buildCropFilter() {
  const position = positionSelect.value;
  if (position === "left") {
    return "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:0:(ih-1920)/2";
  }
  if (position === "right") {
    return "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:iw-1080:(ih-1920)/2";
  }
  return "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-1080)/2:(ih-1920)/2";
}

// 미리보기 위에 입력한 문구를 즉시 보여줍니다.
function updateOverlay() {
  previewOverlay.textContent = overlayText.value.trim();
  previewOverlay.hidden = !overlayText.value.trim();
}

// FFmpeg WebAssembly 엔진을 최초 한 번만 불러옵니다.
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
  ffmpeg.on("progress", ({ progress }) => setProgress(20 + progress * 75, "쇼츠를 렌더링하는 중..."));
  progressListenerAttached = true;
}

// 렌더링 진행률을 화면에 표시합니다.
function setProgress(percent, message) {
  progressWrap.hidden = false;
  progressBar.style.width = `${percent}%`;
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressText.textContent = message;
}

// 텍스트를 FFmpeg drawtext에서 사용할 수 있는 안전한 문자열로 변환합니다.
function escapeDrawText(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%");
}

// 선택한 영상을 쇼츠 규격으로 렌더링합니다.
async function renderShorts() {
  if (!videoFile) return;

  renderBtn.disabled = true;
  downloadBtn.hidden = true;
  setStatus("렌더링을 시작합니다.");

  try {
    await loadFFmpeg();
    attachProgressListener();

    // 이전 작업 파일을 제거합니다.
    for (const name of ["input.mp4", "music", "output.mp4"]) {
      try { await ffmpeg.deleteFile(name); } catch {}
    }

    // 입력 파일을 FFmpeg 가상 파일 시스템에 저장합니다.
    await ffmpeg.writeFile("input.mp4", await fetchFile(videoFile));

    // 배경음악이 있다면 함께 가상 파일 시스템에 저장합니다.
    if (audioFile) {
      await ffmpeg.writeFile("music", await fetchFile(audioFile));
    }

    const targetDuration = getTargetDuration();
    const cutStart = getCutStart();
    const args = ["-ss", String(cutStart), "-i", "input.mp4"];

    // 배경음악이 있으면 두 번째 입력으로 추가합니다.
    if (audioFile) args.push("-i", "music");

    const filter = buildCropFilter();
    const text = overlayText.value.trim();

    // 문구가 있으면 기본 흰색 텍스트를 하단에 합성합니다.
    const videoFilter = text
      ? `${filter},drawtext=text='${escapeDrawText(text)}':fontcolor=white:fontsize=54:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h-260`
      : filter;

    args.push("-vf", videoFilter, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p");

    // 원하는 길이가 원본보다 짧으면 시작부터 해당 길이만 사용합니다.
    if (targetDuration > 0) args.push("-t", String(targetDuration));

    if (audioFile) {
      args.push("-map", "0:v:0", "-map", "1:a:0", "-shortest", "-c:a", "aac", "-b:a", "192k");
    } else {
      args.push("-c:a", "aac", "-b:a", "128k");
    }

    args.push("-movflags", "+faststart", "-y", "output.mp4");

    // FFmpeg 로그를 받아 현재 작업 단계를 사용자에게 보여줍니다.
    setProgress(18, "9:16 변환과 자동 컷을 적용하는 중...");
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
    setStatus("쇼츠가 완성되었습니다. 미리보기에서 확인한 뒤 다운로드하세요.");
  } catch (error) {
    console.error(error);
    setStatus("렌더링에 실패했습니다. 브라우저 메모리 또는 입력 파일 형식을 확인해주세요.");
    setProgress(0, "렌더링 실패");
  } finally {
    renderBtn.disabled = !videoFile;
  }
}

// 드래그 앤 드롭으로 영상 파일을 받을 수 있게 합니다.
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragging");
});

dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  setVideo(event.dataTransfer.files[0]);
});

// 파일 선택 이벤트를 연결합니다.
videoInput.addEventListener("change", () => setVideo(videoInput.files[0]));
audioInput.addEventListener("change", () => setAudio(audioInput.files[0]));
overlayText.addEventListener("input", updateOverlay);
renderBtn.addEventListener("click", renderShorts);

// 선택한 영상을 제거합니다.
removeVideo.addEventListener("click", () => {
  videoFile = null;
  sourceDuration = 0;
  videoInput.value = "";
  fileInfo.hidden = true;
  previewVideo.removeAttribute("src");
  previewVideo.load();
  previewVideo.hidden = true;
  emptyPreview.hidden = false;
  renderBtn.disabled = true;
  setStatus("영상을 선택해주세요.");
});

// 선택한 배경음악을 제거합니다.
clearAudio.addEventListener("click", () => {
  audioFile = null;
  audioInput.value = "";
  audioName.textContent = "선택하지 않음";
  clearAudio.hidden = true;
});

// 상단 버튼이 편집기로 부드럽게 이동하도록 처리합니다.
document.querySelectorAll("[data-scroll]").forEach((button) => {
  button.addEventListener("click", () => {
    const target = document.querySelector(button.dataset.scroll);
    if (target) target.scrollIntoView({ behavior: "smooth" });
  });
});
