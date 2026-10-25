import { TIMING } from "@/lib/config";

/**
 * Áudio do painel. Os arquivos /som/*.mp3 são opcionais (o projeto original
 * não os distribui); quando não existem, geramos um bipe via WebAudio para
 * manter o alerta sonoro sem quebrar o fluxo.
 */

type AudioKind = "notification" | "boot" | "attention";

const SOURCES: Record<AudioKind, string> = {
    // Arquivos que já acompanham o projeto ficam em /sound. O boot usa o
    // caminho opcional /som e cai no bipe via WebAudio quando não existe.
    notification: "/sound/notificacao.mp3",
    boot: "/som/bom_dia_magnata.mp3",
    attention: "/sound/nott.mp3",
};

const VOLUMES: Record<AudioKind, number> = {
    notification: 0.6,
    boot: 0.5,
    attention: 0.7,
};

const fileState: Record<AudioKind, "unknown" | "ok" | "missing"> = {
    notification: "unknown",
    boot: "unknown",
    attention: "unknown",
};

const elements: Partial<Record<AudioKind, HTMLAudioElement>> = {};
let context: AudioContext | null = null;
let unlocked = false;
let ready = false;
let muted = false;
let attentionActive = false;
let attentionTimer: number | null = null;

function getContext() {
    if (typeof window === "undefined") return null;
    if (context) return context;
    const Ctor =
        window.AudioContext ??
        (
            window as unknown as {
                webkitAudioContext?: typeof AudioContext;
            }
        ).webkitAudioContext;
    if (!Ctor) return null;
    try {
        context = new Ctor();
    } catch {
        context = null;
    }
    return context;
}

export function unlockAudio() {
    unlocked = true;
    const ctx = getContext();
    if (ctx?.state === "suspended") {
        void ctx.resume().catch(() => undefined);
    }
}

function tone(
    frequency: number,
    durationMs: number,
    delayMs = 0,
    type: OscillatorType = "sine",
    gain = 0.05,
) {
    if (!unlocked || typeof window === "undefined") return;
    const ctx = getContext();
    if (!ctx) return;
    try {
        const start = ctx.currentTime + delayMs / 1000;
        const oscillator = ctx.createOscillator();
        const volume = ctx.createGain();
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, start);
        volume.gain.setValueAtTime(0.0001, start);
        volume.gain.exponentialRampToValueAtTime(gain, start + 0.015);
        volume.gain.exponentialRampToValueAtTime(
            0.0001,
            start + durationMs / 1000,
        );
        oscillator.connect(volume);
        volume.connect(ctx.destination);
        oscillator.start(start);
        oscillator.stop(start + durationMs / 1000 + 0.03);
    } catch {
        // áudio é acessório
    }
}

function fallbackTone(kind: AudioKind) {
    if (kind === "notification") {
        tone(880, 120, 0, "triangle", 0.06);
        tone(1180, 150, 150, "triangle", 0.05);
        return;
    }
    if (kind === "boot") {
        tone(392, 180, 0);
        tone(523.25, 220, 180);
        tone(659.25, 360, 380);
        return;
    }
    tone(740, 160, 0, "square", 0.035);
    tone(520, 180, 190, "square", 0.03);
    tone(740, 160, 400, "square", 0.035);
}

function element(kind: AudioKind) {
    if (typeof window === "undefined") return null;
    if (elements[kind]) return elements[kind]!;
    const audio = new Audio(SOURCES[kind]);
    audio.preload = "auto";
    audio.volume = VOLUMES[kind];
    elements[kind] = audio;
    return audio;
}

function playFile(kind: AudioKind): Promise<boolean> {
    if (!unlocked || fileState[kind] === "missing") {
        return Promise.resolve(false);
    }
    const audio = element(kind);
    if (!audio) return Promise.resolve(false);
    try {
        audio.currentTime = 0;
        return audio.play().then(
            () => {
                fileState[kind] = "ok";
                return true;
            },
            () => {
                fileState[kind] = "missing";
                return false;
            },
        );
    } catch {
        fileState[kind] = "missing";
        return Promise.resolve(false);
    }
}

async function play(kind: AudioKind) {
    if (!unlocked) return;
    const fromFile = await playFile(kind);
    if (!fromFile) fallbackTone(kind);
}

export const audio = {
    setReady(value: boolean) {
        ready = value;
        if (!ready) audio.syncAttention(false);
    },
    setMuted(value: boolean) {
        muted = value;
        if (muted) audio.syncAttention(false);
    },
    playBoot() {
        if (!unlocked) return;
        void play("boot");
    },
    playNotification() {
        if (!ready || muted) return;
        void play("notification");
    },
    playAttention() {
        if (!ready || muted) return;
        void play("attention");
    },
    syncAttention(active: boolean) {
        const shouldRun = active && ready && !muted;
        if (!shouldRun) {
            attentionActive = false;
            if (attentionTimer !== null) {
                window.clearInterval(attentionTimer);
                attentionTimer = null;
            }
            const audioElement = elements.attention;
            if (audioElement) {
                try {
                    audioElement.pause();
                    audioElement.currentTime = 0;
                } catch {
                    // ignore
                }
            }
            return;
        }
        if (attentionActive) return;
        attentionActive = true;
        audio.playAttention();
        attentionTimer = window.setInterval(() => {
            audio.playAttention();
        }, TIMING.ATTENTION_AUDIO_INTERVAL_MS);
    },
};

export function primeAudioFromGesture() {
    unlockAudio();
    const ctx = getContext();
    if (ctx) {
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        try {
            source.start(0);
        } catch {
            // ignore
        }
    }
}
