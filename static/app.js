/* =========================================
   VoiceForge AI — Application Logic
   ========================================= */

(function () {
    "use strict";

    // --- DOM Elements ---
    const textInput = document.getElementById("textInput");
    const charCounter = document.getElementById("charCounter");
    const voiceSelect = document.getElementById("voiceSelect");
    const voiceInfo = document.getElementById("voiceInfo");
    const speedSlider = document.getElementById("speedSlider");
    const speedValue = document.getElementById("speedValue");
    const pitchSlider = document.getElementById("pitchSlider");
    const pitchValue = document.getElementById("pitchValue");
    const volumeSlider = document.getElementById("volumeSlider");
    const volumeValue = document.getElementById("volumeValue");
    const generateBtn = document.getElementById("generateBtn");
    const btnContent = generateBtn.querySelector(".btn-content");
    const btnLoading = generateBtn.querySelector(".btn-loading");
    const emptyState = document.getElementById("emptyState");
    const playerSection = document.getElementById("playerSection");
    const errorState = document.getElementById("errorState");
    const errorMessage = document.getElementById("errorMessage");
    const retryBtn = document.getElementById("retryBtn");
    const playBtn = document.getElementById("playBtn");
    const iconPlay = document.getElementById("iconPlay");
    const iconPause = document.getElementById("iconPause");
    const currentTimeEl = document.getElementById("currentTime");
    const totalTimeEl = document.getElementById("totalTime");
    const progressBarWrap = document.getElementById("progressBarWrap");
    const progressBar = document.getElementById("progressBar");
    const progressKnob = document.getElementById("progressKnob");
    const waveformCanvas = document.getElementById("waveformCanvas");
    const downloadMp3 = document.getElementById("downloadMp3");
    const downloadWav = document.getElementById("downloadWav");
    const infoVoice = document.getElementById("infoVoice");
    const infoDuration = document.getElementById("infoDuration");
    const infoSize = document.getElementById("infoSize");
    const bgParticles = document.getElementById("bgParticles");

    // --- State ---
    let audio = null;
    let audioBlob = null;
    let audioContext = null;
    let analyser = null;
    let sourceNode = null;
    let animationId = null;
    let voices = [];
    let isPlaying = false;
    let currentVoiceLabel = "";

    // --- Initialize ---
    init();

    function init() {
        createParticles();
        loadVoices();
        setupEventListeners();
    }

    // --- Background Particles ---
    function createParticles() {
        const count = 15;
        for (let i = 0; i < count; i++) {
            const particle = document.createElement("div");
            particle.className = "particle";
            const size = Math.random() * 1.5 + 0.5;
            const left = Math.random() * 100;
            const duration = Math.random() * 20 + 14;
            const delay = Math.random() * 14;
            particle.style.cssText = `
                width: ${size}px;
                height: ${size}px;
                left: ${left}%;
                background: rgba(255, 255, 255, 0.15);
                box-shadow: 0 0 ${size * 2}px rgba(255, 255, 255, 0.05);
                animation-duration: ${duration}s;
                animation-delay: ${delay}s;
            `;
            bgParticles.appendChild(particle);
        }
    }

    // --- Load Voices ---
    async function loadVoices() {
        try {
            const response = await fetch("/api/voices");
            const data = await response.json();
            voices = data.voices;
            populateVoiceSelect();
        } catch (err) {
            console.error("Failed to load voices:", err);
            voiceSelect.innerHTML = '<option value="en-US-AriaNeural">Aria — Female</option>';
        }
    }

    function populateVoiceSelect() {
        voiceSelect.innerHTML = "";

        voices.forEach((v) => {
            const option = document.createElement("option");
            option.value = v.id;
            option.textContent = `${v.name} — ${v.gender} — ${v.tag}`;
            voiceSelect.appendChild(option);
        });

        // Select first voice and show info
        if (voices.length > 0) {
            voiceSelect.value = voices[0].id;
            updateVoiceInfo(voices[0]);
        }
    }

    function updateVoiceInfo(voice) {
        if (voice) {
            voiceInfo.textContent = `${voice.gender} • ${voice.tag}`;
            currentVoiceLabel = voice.name;
        }
    }

    // --- Event Listeners ---
    function setupEventListeners() {
        // Character counter
        textInput.addEventListener("input", () => {
            const len = textInput.value.length;
            charCounter.textContent = `${len.toLocaleString()} / 5,000`;
            charCounter.className = "char-counter";
            if (len > 4500) charCounter.classList.add("danger");
            else if (len > 4000) charCounter.classList.add("warning");
        });

        // Voice select change
        voiceSelect.addEventListener("change", () => {
            const voice = voices.find((v) => v.id === voiceSelect.value);
            updateVoiceInfo(voice);
        });

        // Speed slider
        speedSlider.addEventListener("input", () => {
            const val = parseInt(speedSlider.value);
            const multiplier = 1 + val / 100;
            speedValue.textContent = `${multiplier.toFixed(1)}x`;
        });

        // Pitch slider
        pitchSlider.addEventListener("input", () => {
            const val = parseInt(pitchSlider.value);
            pitchValue.textContent = `${val >= 0 ? "+" : ""}${val} Hz`;
        });

        // Volume slider
        volumeSlider.addEventListener("input", () => {
            const val = parseInt(volumeSlider.value);
            const pct = 100 + val;
            volumeValue.textContent = `${pct}%`;
        });

        // Generate button
        generateBtn.addEventListener("click", handleGenerate);

        // Play/Pause
        playBtn.addEventListener("click", togglePlayPause);

        // Progress bar seeking
        progressBarWrap.addEventListener("click", (e) => {
            if (!audio) return;
            const rect = progressBarWrap.getBoundingClientRect();
            const pos = (e.clientX - rect.left) / rect.width;
            audio.currentTime = pos * audio.duration;
        });

        // Download buttons
        downloadMp3.addEventListener("click", () => downloadAudio("mp3"));
        downloadWav.addEventListener("click", () => downloadAudio("wav"));

        // Retry button
        retryBtn.addEventListener("click", handleGenerate);
    }

    // --- Generate Speech ---
    async function handleGenerate() {
        const text = textInput.value.trim();
        if (!text) {
            textInput.focus();
            textInput.style.borderColor = "rgba(239, 68, 68, 0.5)";
            setTimeout(() => (textInput.style.borderColor = ""), 1500);
            return;
        }

        // Prepare request data
        const speedVal = parseInt(speedSlider.value);
        const pitchVal = parseInt(pitchSlider.value);
        const volumeVal = parseInt(volumeSlider.value);

        const rate = `${speedVal >= 0 ? "+" : ""}${speedVal}%`;
        const pitch = `${pitchVal >= 0 ? "+" : ""}${pitchVal}Hz`;
        const volume = `${volumeVal >= 0 ? "+" : ""}${volumeVal}%`;

        const requestData = {
            text: text,
            voice: voiceSelect.value,
            rate: rate,
            pitch: pitch,
            volume: volume,
            format: "mp3",
        };

        // Show loading
        setLoading(true);
        showState("empty");

        try {
            const response = await fetch("/api/synthesize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestData),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || `Server error: ${response.status}`);
            }

            audioBlob = await response.blob();

            if (audioBlob.size === 0) {
                throw new Error("Generated audio is empty. Try different text.");
            }

            // Create audio URL
            const audioUrl = URL.createObjectURL(audioBlob);

            // Stop previous audio
            if (audio) {
                audio.pause();
                audio.src = "";
                cancelAnimationFrame(animationId);
            }

            audio = new Audio(audioUrl);
            audio.addEventListener("loadedmetadata", onAudioLoaded);
            audio.addEventListener("timeupdate", onTimeUpdate);
            audio.addEventListener("ended", onAudioEnded);

            setLoading(false);
            showState("player");

        } catch (err) {
            console.error("Synthesis failed:", err);
            setLoading(false);
            errorMessage.textContent = err.message || "Something went wrong. Please try again.";
            showState("error");
        }
    }

    // --- Loading State ---
    function setLoading(loading) {
        generateBtn.disabled = loading;
        btnContent.style.display = loading ? "none" : "flex";
        btnLoading.style.display = loading ? "flex" : "none";

        if (loading) {
            document.getElementById("outputPanel").classList.add("loading");
        } else {
            document.getElementById("outputPanel").classList.remove("loading");
        }
    }

    // --- Show State ---
    function showState(state) {
        emptyState.style.display = state === "empty" ? "flex" : "none";
        playerSection.style.display = state === "player" ? "block" : "none";
        errorState.style.display = state === "error" ? "flex" : "none";
    }

    // --- Audio Events ---
    function onAudioLoaded() {
        totalTimeEl.textContent = formatTime(audio.duration);

        // Update info chips
        const voice = voices.find((v) => v.id === voiceSelect.value);
        infoVoice.textContent = voice ? voice.name : voiceSelect.value;
        infoDuration.textContent = formatTime(audio.duration);
        infoSize.textContent = formatBytes(audioBlob.size);

        // Setup waveform visualization
        setupWaveform();

        // Auto-play
        audio.play();
        isPlaying = true;
        updatePlayPauseUI();
    }

    function onTimeUpdate() {
        if (!audio || !audio.duration) return;
        const progress = (audio.currentTime / audio.duration) * 100;
        progressBar.style.width = `${progress}%`;
        progressKnob.style.left = `${progress}%`;
        currentTimeEl.textContent = formatTime(audio.currentTime);
    }

    function onAudioEnded() {
        isPlaying = false;
        updatePlayPauseUI();
        cancelAnimationFrame(animationId);
    }

    // --- Play/Pause ---
    function togglePlayPause() {
        if (!audio) return;
        if (isPlaying) {
            audio.pause();
        } else {
            audio.play();
        }
        isPlaying = !isPlaying;
        updatePlayPauseUI();
    }

    function updatePlayPauseUI() {
        iconPlay.style.display = isPlaying ? "none" : "block";
        iconPause.style.display = isPlaying ? "block" : "none";
    }

    // --- Waveform Visualization ---
    function setupWaveform() {
        const canvas = waveformCanvas;
        const ctx = canvas.getContext("2d");

        // High-res canvas
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        try {
            // Create audio context
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            // Disconnect previous
            if (sourceNode) {
                try { sourceNode.disconnect(); } catch (e) {}
            }

            analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            sourceNode = audioContext.createMediaElementSource(audio);
            sourceNode.connect(analyser);
            analyser.connect(audioContext.destination);

            drawWaveform(ctx, rect.width, rect.height);
        } catch (err) {
            // Fallback: draw a static waveform
            drawStaticWaveform(ctx, rect.width, rect.height);
        }
    }

    function drawWaveform(ctx, width, height) {
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        function draw() {
            animationId = requestAnimationFrame(draw);
            analyser.getByteFrequencyData(dataArray);

            ctx.clearRect(0, 0, width, height);

            const barCount = 64;
            const barWidth = width / barCount;
            const gap = 2;

            for (let i = 0; i < barCount; i++) {
                const dataIndex = Math.floor((i / barCount) * bufferLength);
                const value = dataArray[dataIndex];
                const barHeight = (value / 255) * (height * 0.8);
                const x = i * barWidth;
                const y = (height - barHeight) / 2;

                // Orange-tinted bars
                const r = 255;
                const g = Math.floor(60 + (value / 255) * 40);
                const b = 0;
                const alpha = 0.25 + (value / 255) * 0.55;

                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                ctx.beginPath();
                const cornerRadius = Math.min(barWidth / 2 - gap / 2, 3);
                roundedRect(ctx, x + gap / 2, y, barWidth - gap, barHeight, cornerRadius);
                ctx.fill();

                ctx.shadowColor = `rgba(255, 79, 0, 0.08)`;
                ctx.shadowBlur = 4;
            }
            ctx.shadowBlur = 0;
        }

        draw();
    }

    function drawStaticWaveform(ctx, width, height) {
        ctx.clearRect(0, 0, width, height);
        const barCount = 64;
        const barWidth = width / barCount;
        const gap = 2;

        for (let i = 0; i < barCount; i++) {
            const value = Math.sin(i * 0.3) * 0.3 + Math.random() * 0.4 + 0.15;
            const barHeight = value * height * 0.7;
            const x = i * barWidth;
            const y = (height - barHeight) / 2;
            const darkness = 60 + (i / barCount) * 30;

            ctx.fillStyle = `rgba(255, ${80 + darkness}, 0, 0.15)`;
            ctx.beginPath();
            roundedRect(ctx, x + gap / 2, y, barWidth - gap, barHeight, 2);
            ctx.fill();
        }
    }

    function roundedRect(ctx, x, y, w, h, r) {
        if (h < 1) h = 1;
        if (w < 1) return;
        r = Math.min(r, h / 2, w / 2);
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    // --- Download ---
    function downloadAudio(format) {
        if (!audioBlob) return;

        // For MP3, we already have the blob
        if (format === "mp3") {
            triggerDownload(audioBlob, `voiceforge_audio.mp3`);
        } else if (format === "wav") {
            // Convert MP3 blob to WAV using AudioContext
            convertToWav(audioBlob).then((wavBlob) => {
                triggerDownload(wavBlob, `voiceforge_audio.wav`);
            }).catch(() => {
                // Fallback: download as mp3 anyway
                triggerDownload(audioBlob, `voiceforge_audio.mp3`);
            });
        }
    }

    async function convertToWav(mp3Blob) {
        const arrayBuffer = await mp3Blob.arrayBuffer();
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        // Encode WAV
        const numberOfChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const length = audioBuffer.length;

        // Interleave channels
        let interleaved;
        if (numberOfChannels === 1) {
            interleaved = audioBuffer.getChannelData(0);
        } else {
            interleaved = new Float32Array(length * 2);
            const left = audioBuffer.getChannelData(0);
            const right = audioBuffer.getChannelData(1);
            for (let i = 0; i < length; i++) {
                interleaved[i * 2] = left[i];
                interleaved[i * 2 + 1] = right[i];
            }
        }

        // Write WAV header + data
        const wavBuffer = encodeWAV(interleaved, sampleRate, numberOfChannels);
        ctx.close();
        return new Blob([wavBuffer], { type: "audio/wav" });
    }

    function encodeWAV(samples, sampleRate, numChannels) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        function writeString(offset, str) {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        }

        // RIFF header
        writeString(0, "RIFF");
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(8, "WAVE");

        // fmt chunk
        writeString(12, "fmt ");
        view.setUint32(16, 16, true);         // chunk size
        view.setUint16(20, 1, true);          // PCM format
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * 2, true); // byte rate
        view.setUint16(32, numChannels * 2, true); // block align
        view.setUint16(34, 16, true);         // bits per sample

        // data chunk
        writeString(36, "data");
        view.setUint32(40, samples.length * 2, true);

        // Write PCM samples
        let offset = 44;
        for (let i = 0; i < samples.length; i++, offset += 2) {
            let s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }

        return buffer;
    }

    function triggerDownload(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    // --- Utilities ---
    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return "0:00";
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    }
})();
