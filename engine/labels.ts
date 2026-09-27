/**
 * Names and words that float over things. They are ordinary HTML elements
 * moved each frame to where their owner appears on screen: text stays crisp
 * at any size, any script renders with the system's own fonts, and tapping a
 * word is just a click on a button.
 *
 * The engine writes `transform` directly — React never re-renders for this.
 */
import * as THREE from "three";

export type LabelKind = "character" | "enemy" | "landmark" | "gate" | "bark";

export type LabelSpec = {
    id: string;
    kind: LabelKind;
    /** the name, in the reader's own language */
    title: string;
    /** a second line: a role, a tier */
    subtitle?: string;
    /** the word for it in the language being learned; tapping it opens the word card */
    word?: { entryId: number; text: string; hint: string | null };
    /** a marker above the title: someone a quest points at */
    sought?: boolean;
    /** how near the hero must be before it shows */
    range: number;
};

type Live = {
    spec: LabelSpec;
    element: HTMLDivElement;
    anchor: THREE.Object3D;
    lift: number;
    shown: boolean;
    /** a building stands between the camera and its owner */
    walled: boolean;
    /** bark bubbles vanish by themselves */
    expires: number | null;
};

const projected = new THREE.Vector3();

export class Labels {
    private live = new Map<string, Live>();
    private wallsCheckedAt = 0;

    constructor(
        private layer: HTMLElement,
        private onWord: (entryId: number) => void,
    ) { }

    add(spec: LabelSpec, anchor: THREE.Object3D, lift: number): void {
        this.remove(spec.id);
        const element = document.createElement("div");
        element.className = `wb-label wb-label-${spec.kind}`;
        element.dataset.offscreenOk = "";

        if (spec.sought) {
            const marker = document.createElement("div");
            marker.className = "wb-label-sought";
            marker.textContent = "!";
            element.appendChild(marker);
        }
        if (spec.word) {
            const word = spec.word;
            const button = document.createElement("button");
            button.type = "button";
            button.className = "wb-label-word";
            button.textContent = word.text;
            button.setAttribute("aria-label", `${word.text} — look up this word`);
            if (word.hint) {
                const hint = document.createElement("span");
                hint.className = "wb-label-hint";
                hint.textContent = word.hint;
                button.appendChild(hint);
            }
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                this.onWord(word.entryId);
            });
            element.appendChild(button);
        }
        const title = document.createElement("div");
        title.className = "wb-label-title";
        title.textContent = spec.title;
        element.appendChild(title);
        if (spec.subtitle) {
            const subtitle = document.createElement("div");
            subtitle.className = "wb-label-subtitle";
            subtitle.textContent = spec.subtitle;
            element.appendChild(subtitle);
        }

        element.style.opacity = "0";
        this.layer.appendChild(element);
        this.live.set(spec.id, { spec, element, anchor, lift, shown: false, walled: false, expires: null });
    }

    /** a speech bubble that fades by itself; `content` is built by the caller (it may hold tappable words) */
    say(id: string, anchor: THREE.Object3D, lift: number, content: HTMLElement, seconds: number, now: number): void {
        this.remove(id);
        const element = document.createElement("div");
        element.className = "wb-label wb-label-bark";
        element.dataset.offscreenOk = "";
        element.appendChild(content);
        element.style.opacity = "0";
        this.layer.appendChild(element);
        this.live.set(id, {
            spec: { id, kind: "bark", title: "", range: 26 },
            element, anchor, lift, shown: false, walled: false, expires: now + seconds,
        });
    }

    remove(id: string): void {
        const label = this.live.get(id);
        if (!label) return;
        label.element.remove();
        this.live.delete(id);
    }

    has(id: string): boolean {
        return this.live.has(id);
    }

    clear(): void {
        for (const label of this.live.values()) label.element.remove();
        this.live.clear();
    }

    /** hide everything at once while a panel has the screen */
    setVisible(visible: boolean): void {
        this.layer.style.visibility = visible ? "visible" : "hidden";
    }

    update(
        camera: THREE.Camera, hero: THREE.Vector3, width: number, height: number, now: number,
        hidden?: (x: number, z: number) => boolean,
    ): void {
        // walls are checked a few times a second, not every frame: a name may linger a moment, which is fine
        const checkWalls = hidden !== undefined && now - this.wallsCheckedAt > 0.25;
        if (checkWalls) this.wallsCheckedAt = now;

        for (const [id, label] of this.live) {
            if (label.expires !== null && now > label.expires) {
                this.remove(id);
                continue;
            }

            label.anchor.getWorldPosition(projected);
            const distance = Math.hypot(projected.x - hero.x, projected.z - hero.z);
            if (checkWalls && distance < label.spec.range) label.walled = hidden!(projected.x, projected.z);
            projected.y += label.lift;
            projected.project(camera);

            const onScreen = projected.z < 1 && projected.z > -1
                && projected.x > -1.15 && projected.x < 1.15
                && projected.y > -1.15 && projected.y < 1.15;
            const near = distance < label.spec.range;
            const show = onScreen && near && !label.walled;

            if (show) {
                const x = (projected.x * 0.5 + 0.5) * width;
                const y = (-projected.y * 0.5 + 0.5) * height;
                // farther labels shrink a little, so the near one reads as the near one
                const scale = THREE.MathUtils.clamp(1.12 - distance / 46, 0.72, 1.05);
                label.element.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`;
                label.element.style.zIndex = String(1000 - Math.round(distance * 10));
            }
            if (show !== label.shown) {
                label.element.style.opacity = show ? "1" : "0";
                label.element.style.pointerEvents = show ? "" : "none";
                label.shown = show;
            }
        }
    }
}
