"use client";

import { useState, type ChangeEvent } from "react";
import { copyText } from "@/lib/clipboard";
import { fwAlert } from "@/lib/modal";
import { TOOL_DEFAULTS } from "@/lib/config";
import { ToolWindow } from "./tool-window";

interface N2Data {
    colaborador: string;
    matricula: string;
    site: string;
    protocolo: string;
    data: string;
    hostname: string;
    patrimonio: string;
    descricao: string;
}

const EMPTY_DATA: N2Data = {
    colaborador: "",
    matricula: "",
    site: "",
    protocolo: "",
    data: new Date().toLocaleDateString("pt-BR"),
    hostname: "",
    patrimonio: "",
    descricao: "",
};

const fields: {
    key: keyof N2Data;
    label: string;
    placeholder: string;
    multiline?: boolean;
}[] = [
    {
        key: "colaborador",
        label: "Colaborador",
        placeholder: "Nome do colaborador",
    },
    {
        key: "matricula",
        label: "Matrícula",
        placeholder: "Número da matrícula",
    },
    { key: "site", label: "Site", placeholder: "JPA, MOC, CPV..." },
    { key: "protocolo", label: "Protocolo", placeholder: "Número do protocolo" },
    { key: "data", label: "Data", placeholder: "DD/MM/AAAA" },
    { key: "hostname", label: "Hostname", placeholder: "Hostname da máquina" },
    {
        key: "patrimonio",
        label: "Patrimônio",
        placeholder: "Patrimônio da máquina",
    },
    {
        key: "descricao",
        label: "Descrição",
        placeholder: "Descreva o motivo da transferência",
        multiline: true,
    },
];

function createN2Script(data: N2Data) {
    return [
        "TRANSFERÊNCIA PARA N2",
        `Colaborador: ${data.colaborador.trim()}`,
        `Matrícula: ${data.matricula.trim()}`,
        `Site: ${data.site.trim()}`,
        `Protocolo: ${data.protocolo.trim()}`,
        `Data: ${data.data.trim()}`,
        `Hostname: ${data.hostname.trim()}`,
        `Patrimônio: ${data.patrimonio.trim()}`,
        `\nDescrição: ${data.descricao.trim()}`,
    ].join("\n");
}

export function N2Tool({
    open,
    onClose,
}: {
    open: boolean;
    onClose: () => void;
}) {
    const [data, setData] = useState<N2Data>(EMPTY_DATA);
    const [result, setResult] = useState("");

    function updateField(
        event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) {
        const { name, value } = event.target;
        setData((current) => ({
            ...current,
            [name]: value,
        }));
    }

    function generate() {
        setResult(createN2Script(data));
    }

    function clear() {
        setData({ ...EMPTY_DATA, data: new Date().toLocaleDateString("pt-BR") });
        setResult("");
    }

    async function copyResult() {
        if (!result) return;
        try {
            await copyText(result);
            void fwAlert("✓ Máscara de transferência N2 copiada.");
        } catch {
            void fwAlert("⚠️ Não foi possível copiar a máscara.");
        }
    }

    return (
        <ToolWindow
            id="n2-window"
            title=">_ MÁSCARA_N2.EXE"
            color="#c27aff"
            defaults={TOOL_DEFAULTS.fluxos}
            minSize={{ width: 380, height: 420 }}
            headerStyle={{
                background: "rgb(173 70 255/0.1)",
                borderBottom: "1px solid rgba(173,70,255,0.3)",
            }}
            style={{ border: "1px solid rgba(194,122,255,0.3)" }}
            className={"shadow-purple-500/20!"}
            open={open}
            onClose={onClose}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    padding: 16,
                    overflow: "auto",
                }}
            >
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                        gap: 10,
                    }}
                >
                    {fields.map((field) => {
                        const commonProps = {
                            id: `n2-${field.key}`,
                            name: field.key,
                            value: data[field.key],
                            onChange: updateField,
                            placeholder: field.placeholder,
                        };

                        return (
                            <label
                                key={field.key}
                                htmlFor={commonProps.id}
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 4,
                                    ...(field.multiline
                                        ? { gridColumn: "1 / -1" }
                                        : {}),
                                    color: "#c4b5fd",
                                    fontSize: "0.65rem",
                                    textTransform: "uppercase",
                                }}
                            >
                                {field.label}
                                {field.multiline ? (
                                    <textarea
                                        {...commonProps}
                                        rows={6}
                                        style={{
                                            ...inputStyle,
                                            minHeight: 80,
                                            resize: "vertical",
                                        }}
                                    />
                                ) : (
                                    <input {...commonProps} style={inputStyle} />
                                )}
                            </label>
                        );
                    })}
                </div>

                <div style={buttonRowStyle}>
                    <button
                        type="button"
                        onClick={generate}
                        style={{ ...buttonStyle, background: "#7c3aed" }}
                    >
                        Gerar transferência
                    </button>
                    <button
                        type="button"
                        onClick={clear}
                        style={{ ...buttonStyle, background: "#1e3a5f" }}
                    >
                        Limpar
                    </button>
                </div>

                {result ? (
                    <section
                        aria-live="polite"
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                        }}
                    >
                        <div style={resultHeaderStyle}>
                            <strong>Resultado</strong>
                            <button
                                type="button"
                                onClick={() => void copyResult()}
                                style={{
                                    ...buttonStyle,
                                    flex: "0 0 auto",
                                    padding: "6px 10px",
                                    background: "#059669",
                                }}
                            >
                                Copiar
                            </button>
                        </div>
                        <pre style={resultStyle}>{result}</pre>
                    </section>
                ) : null}
            </div>
        </ToolWindow>
    );
}

const inputStyle = {
    width: "100%",
    boxSizing: "border-box" as const,
    padding: "7px 9px",
    color: "#e2e8f0",
    background: "#050a15",
    border: "1px solid rgba(194,122,255,0.3)",
    borderRadius: 4,
    outline: "none",
    font: '0.75rem "Fira Code", monospace',
};

const buttonStyle = {
    flex: 1,
    border: 0,
    borderRadius: 4,
    padding: "9px 10px",
    color: "#fff",
    cursor: "pointer",
    font: '600 0.7rem "Fira Code", monospace',
    textTransform: "uppercase" as const,
};

const buttonRowStyle = {
    display: "flex",
    gap: 8,
};

const resultHeaderStyle = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    color: "#c4b5fd",
    fontSize: "0.75rem",
    textTransform: "uppercase" as const,
};

const resultStyle = {
    margin: 0,
    padding: 12,
    color: "#e2e8f0",
    background: "#050a15",
    border: "1px solid rgba(194,122,255,0.3)",
    borderRadius: 4,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-word" as const,
    font: '0.72rem/1.6 "Fira Code", monospace',
};
