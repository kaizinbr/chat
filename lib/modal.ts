"use client";

import { useSyncExternalStore } from "react";

export type ModalButtonStyle = "default" | "danger" | "success";

export interface ModalButton {
    label: string;
    value: boolean;
    style?: ModalButtonStyle;
}

export interface ModalRequest {
    id: number;
    message: string;
    buttons: ModalButton[];
    resolve: (value: boolean) => void;
}

let nextId = 1;
let current: ModalRequest | null = null;
const queue: ModalRequest[] = [];
const listeners = new Set<() => void>();

function emit() {
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function getSnapshot() {
    return current;
}

function getServerSnapshot() {
    return null;
}

function openNext() {
    if (current || queue.length === 0) return;
    current = queue.shift() ?? null;
    emit();
}

export function fwModal(
    message: string,
    buttons: ModalButton[],
): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        queue.push({ id: nextId++, message, buttons, resolve });
        openNext();
    });
}

function close(value: boolean) {
    const item = current;
    current = null;
    if (item) item.resolve(value);
    openNext();
    if (!current) emit();
}

export function resolveModal(value: boolean) {
    close(value);
}

const ERROR_OR_WARNING = ["❌", "⚠️", "falha", "erro", "não foi possível"];
const POSITIVE = ["✓", "sucesso", "registrado", "salvo"];

/**
 * Porte fiel do fwAlert original: mensagens positivas resolvem sozinhas.
 */
export function fwAlert(message: string): Promise<boolean> {
    const text = String(message ?? "");
    const lower = text.toLowerCase();
    const isErrorOrWarning = ERROR_OR_WARNING.some((token) =>
        token === token.toUpperCase()
            ? text.includes(token)
            : lower.includes(token),
    );
    const isPositive = POSITIVE.some((token) =>
        token === token.toUpperCase()
            ? text.includes(token)
            : lower.includes(token),
    );

    if (!isErrorOrWarning && isPositive) {
        return Promise.resolve(true);
    }

    return fwModal(text, [{ label: "OK", value: true, style: "default" }]);
}

export function fwConfirm(message: string): Promise<boolean> {
    return fwModal(message, [
        { label: "Cancelar", value: false, style: "danger" },
        { label: "Confirmar", value: true, style: "success" },
    ]);
}

export function useModalRequest() {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
