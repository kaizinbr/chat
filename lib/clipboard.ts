export async function copyText(text: string): Promise<void> {
    if (!text) throw new Error("Texto vazio");

    if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        window.isSecureContext
    ) {
        return navigator.clipboard.writeText(text);
    }

    return new Promise<void>((resolve, reject) => {
        try {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const ok = document.execCommand("copy");
            textarea.remove();
            if (ok) resolve();
            else reject(new Error("execCommand copy falhou"));
        } catch (error) {
            reject(error);
        }
    });
}
