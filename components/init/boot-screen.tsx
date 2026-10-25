"use client";

import { useEffect, useRef, useState } from "react";
import { primeAudioFromGesture, audio } from "@/lib/audio";
import { waitForBridgeActivation } from "@/lib/bridge/wait";
import { getToday } from "@/lib/format";
import { STORAGE_KEYS, TIMING } from "@/lib/config";
import { firewall } from "@/store/firewall";

type Phase =
    | "intro"
    | "ready"
    | "validating"
    | "error"
    | "loading"
    | "closing"
    | "done";

const INTRO_MESSAGES = [
    "[SISTEMA] Firewall da Amizade",
    "[BOOT] Aguardando autorização do operador...",
    "",
    ">>> Pressione INICIAR SISTEMA para continuar <<<",
];

const ERROR_TEXT =
    "[ERRO] Elvis Extension Bridge offline.\n" +
    "[AÇÃO] Ative/recarregue a extensão e tente novamente.\n\n" +
    ">>> Pressione INICIAR SISTEMA após normalizar <<<";

/**
 * Decisão de boot tomada uma única vez por documento. Evita que o duplo
 * disparo de efeitos do StrictMode (dev) veja o last_boot_day recém-gravado e
 * pule a tela de boot no primeiro acesso do dia.
 */
let bootDecision: "boot" | "skip" | null = null;

const sleep = (ms: number) =>
    new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function bootMessages(maxSlots: number, atendHoje: number) {
    const now = new Date();
    const hora = now.toLocaleTimeString("pt-BR");
    const data = now.toLocaleDateString("pt-BR");

    return [
        { text: "$ ./firewall_init.sh", delay: 400 },
        { text: `[SYSTEM] Data: ${data} | Hora: ${hora}`, delay: 600 },
        {
            // Mesmo texto (e mesmo typo) do painel original.
            text: "[AUTH] Usuário: Kaio Lucas Silva Nunes",
            delay: 800,
        },
        {
            text: "[LOAD] Inicializando Bridge...",
            delay: 1200,
        },
        { text: "[LOAD] Chat Monitor Service...", delay: 900 },
        {
            text: `[LOAD] Multi-Slot Manager (${maxSlots} slots)...`,
            delay: 1000,
        },
        { text: "[LOAD] Rocket.Chat Integration...", delay: 1100 },
        { text: "[LOAD] Notification System...", delay: 700 },
        { text: `[INFO] Atendimentos hoje: ${atendHoje}`, delay: 500 },
        { text: "[✓] Todos os módulos carregados", delay: 800 },
        { text: "", delay: 300 },
        { text: ">>> ACESSO LIBERADO <<<", delay: 500 },
    ];
}

export default function BootScreen() {
    const [phase, setPhase] = useState<Phase>("intro");
    const [text, setText] = useState("");
    const [buttonVisible, setButtonVisible] = useState(false);
    const busyRef = useRef(false);
    const finishedRef = useRef(false);

    // Introdução + decisão de pular o boot (já visto hoje).
    useEffect(() => {
        let cancelled = false;
        const bootDay = getToday();
        let storedToday = false;
        try {
            storedToday =
                window.localStorage.getItem(STORAGE_KEYS.lastBootDay) ===
                bootDay;
        } catch {
            storedToday = false;
        }

        if (!bootDecision) {
            bootDecision = storedToday ? "skip" : "boot";
            if (bootDecision === "boot") {
                // checkAndPlayBomDia() grava a data no início, não ao concluir.
                try {
                    window.localStorage.setItem(
                        STORAGE_KEYS.lastBootDay,
                        bootDay,
                    );
                } catch {
                    // localStorage pode estar indisponível
                }
            }
        }

        if (bootDecision === "skip") {
            document.documentElement.classList.remove("boot-active");
            document.documentElement.classList.add("boot-skip");
            firewall.getState().setBootComplete(true);
            const skipTimer = window.setTimeout(() => setPhase("done"), 0);
            return () => window.clearTimeout(skipTimer);
        }

        document.documentElement.classList.remove("boot-skip");
        document.documentElement.classList.add("boot-active");

        const messages = [...INTRO_MESSAGES];
        (async () => {
            let output = "";
            for (const message of messages) {
                if (cancelled) return;
                output += `${message}\n`;
                setText(output);
                await sleep(200);
            }
            if (cancelled) return;
            await sleep(300);
            if (!cancelled) setPhase("ready");
            if (!cancelled) setButtonVisible(true);
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    async function handleStart() {
        if (busyRef.current) return;
        busyRef.current = true;
        setButtonVisible(false);
        setPhase("validating");

        const bridgeReady = await waitForBridgeActivation(
            TIMING.BRIDGE_WAIT_MS,
        );

        if (!bridgeReady) {
            setText(ERROR_TEXT);
            setPhase("error");
            setButtonVisible(true);
            busyRef.current = false;
            return;
        }

        // O navegador só libera áudio depois do clique do operador.
        primeAudioFromGesture();
        audio.playBoot();

        const history = firewall.getState().history;
        const today = getToday();
        const todayData = history[today];
        const atendHoje = todayData?.logs?.length ?? 0;

        setText("");
        setPhase("loading");
        let output = "";
        for (const message of bootMessages(
            firewall.getState().maxSlots,
            atendHoje,
        )) {
            output += `${message.text}\n`;
            setText(output);
            await sleep(message.delay);
        }

        await sleep(1000);
        setPhase("closing");

        window.setTimeout(() => {
            document.documentElement.classList.remove("boot-active");
            document.documentElement.classList.add("boot-skip");
            firewall.getState().setBootComplete(true);
            setPhase("done");
            busyRef.current = false;
            finishedRef.current = true;
        }, 500);
    }

    if (phase === "done") return null;

    return (
        <div
            id="boot-screen"
            className={`boot-screen ${
                phase === "closing" ? "boot-closing" : ""
            }`}
            style={{
                opacity: phase === "closing" ? 0 : 1,
                transition: "opacity 0.5s",
            }}
        >
            <div className="boot-card">
                <h1>FIREWALL DA AMIZADE</h1>
                <p>ADAPTADO DE PEDRO ELVIS</p>
                <div className="boot-text">{text}</div>
                <button
                    type="button"
                    id="boot-button"
                    className="boot-button"
                    onClick={handleStart}
                    disabled={!buttonVisible}
                    style={{
                        visibility: buttonVisible ? "visible" : "hidden",
                    }}
                >
                    INICIAR SISTEMA
                </button>
            </div>
        </div>
    );
}
