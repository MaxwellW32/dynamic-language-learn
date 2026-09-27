/**
 * Everything the player does with their hands, reduced to what the game
 * needs: a direction to walk in, a camera to swing, and a few taps.
 *
 * Keyboard: WASD or arrows to walk, Shift to stroll, Space to hop, E or Enter
 * to act. Mouse: drag to look around, wheel to zoom, click the ground to walk
 * there. Touch: the left half of the screen is a joystick, the right half
 * swings the camera, a pinch zooms.
 */

export type InputState = {
    /** where the player wants to go, relative to the camera: x right, y forward; length 0..1 */
    move: { x: number; y: number };
    stroll: boolean;
};

export type InputEvents = {
    onAct: () => void;
    onHop: () => void;
    /** a click or tap that was not a drag, in canvas pixels */
    onTap: (x: number, y: number) => void;
    onOrbit: (dx: number, dy: number) => void;
    onZoom: (amount: number) => void;
    /** the joystick moved: for drawing it. null when released */
    onStick: (stick: { originX: number; originY: number; x: number; y: number } | null) => void;
};

const MOVE_KEYS: Record<string, [number, number]> = {
    KeyW: [0, 1], ArrowUp: [0, 1],
    KeyS: [0, -1], ArrowDown: [0, -1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0],
};

const STICK_RADIUS = 56;
const TAP_SLOP = 7;

export class Input {
    readonly state: InputState = { move: { x: 0, y: 0 }, stroll: false };
    /** while false, keys and drags are ignored (a dialogue or battle has the floor) */
    enabled = true;

    private held = new Set<string>();
    private stick: { id: number; originX: number; originY: number; x: number; y: number } | null = null;
    private look: { id: number; x: number; y: number; travelled: number; startX: number; startY: number } | null = null;
    private pinch: { a: number; b: number; distance: number } | null = null;
    private touches = new Map<number, { x: number; y: number }>();
    private readonly dispose: () => void;

    constructor(private canvas: HTMLElement, private events: InputEvents) {
        const typing = (target: EventTarget | null) => {
            const el = target as HTMLElement | null;
            return el !== null && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
        };

        const keyDown = (event: KeyboardEvent) => {
            if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
            if (!this.enabled) return;
            if (event.code in MOVE_KEYS) {
                this.held.add(event.code);
                event.preventDefault();
            } else if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
                this.state.stroll = true;
            } else if (event.code === "Space") {
                if (!event.repeat) this.events.onHop();
                event.preventDefault();
            } else if ((event.code === "KeyE" || event.code === "Enter") && !event.repeat) {
                this.events.onAct();
                event.preventDefault();
            }
            this.recompute();
        };
        const keyUp = (event: KeyboardEvent) => {
            this.held.delete(event.code);
            if (event.code === "ShiftLeft" || event.code === "ShiftRight") this.state.stroll = false;
            this.recompute();
        };
        const blur = () => {
            this.held.clear();
            this.state.stroll = false;
            this.recompute();
        };

        const pointerDown = (event: PointerEvent) => {
            if (!this.enabled) return;
            const rect = this.canvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            this.canvas.setPointerCapture(event.pointerId);

            if (event.pointerType === "touch") {
                this.touches.set(event.pointerId, { x, y });
                if (this.touches.size === 2) {
                    // a second finger turns whatever was happening into a pinch
                    const [a, b] = [...this.touches.keys()];
                    const pa = this.touches.get(a)!;
                    const pb = this.touches.get(b)!;
                    this.pinch = { a, b, distance: Math.hypot(pa.x - pb.x, pa.y - pb.y) };
                    this.releaseStick();
                    this.look = null;
                    return;
                }
                if (x < rect.width * 0.45 && y > rect.height * 0.3 && !this.stick) {
                    this.stick = { id: event.pointerId, originX: x, originY: y, x: 0, y: 0 };
                    this.events.onStick({ originX: x, originY: y, x: 0, y: 0 });
                    return;
                }
            }
            if (event.pointerType === "mouse" && event.button !== 0 && event.button !== 2) return;
            this.look = { id: event.pointerId, x, y, travelled: 0, startX: x, startY: y };
        };

        const pointerMove = (event: PointerEvent) => {
            const rect = this.canvas.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            if (event.pointerType === "touch" && this.touches.has(event.pointerId)) this.touches.set(event.pointerId, { x, y });

            if (this.pinch) {
                const pa = this.touches.get(this.pinch.a);
                const pb = this.touches.get(this.pinch.b);
                if (pa && pb) {
                    const distance = Math.hypot(pa.x - pb.x, pa.y - pb.y);
                    this.events.onZoom((this.pinch.distance - distance) * 0.012);
                    this.pinch.distance = distance;
                }
                return;
            }
            if (this.stick && event.pointerId === this.stick.id) {
                let dx = x - this.stick.originX;
                let dy = y - this.stick.originY;
                const length = Math.hypot(dx, dy);
                if (length > STICK_RADIUS) {
                    dx = (dx / length) * STICK_RADIUS;
                    dy = (dy / length) * STICK_RADIUS;
                }
                this.stick.x = dx / STICK_RADIUS;
                this.stick.y = -dy / STICK_RADIUS;
                this.events.onStick({ originX: this.stick.originX, originY: this.stick.originY, x: dx, y: dy });
                this.recompute();
                return;
            }
            if (this.look && event.pointerId === this.look.id) {
                const dx = x - this.look.x;
                const dy = y - this.look.y;
                this.look.travelled += Math.abs(dx) + Math.abs(dy);
                this.look.x = x;
                this.look.y = y;
                if (this.look.travelled > TAP_SLOP) this.events.onOrbit(dx, dy);
            }
        };

        const pointerUp = (event: PointerEvent) => {
            this.touches.delete(event.pointerId);
            if (this.pinch && (event.pointerId === this.pinch.a || event.pointerId === this.pinch.b)) {
                this.pinch = null;
                return;
            }
            if (this.stick && event.pointerId === this.stick.id) {
                this.releaseStick();
                return;
            }
            if (this.look && event.pointerId === this.look.id) {
                const tapped = this.look.travelled <= TAP_SLOP;
                const { startX, startY } = this.look;
                this.look = null;
                if (tapped && this.enabled && event.button !== 2) this.events.onTap(startX, startY);
            }
        };

        const wheel = (event: WheelEvent) => {
            if (!this.enabled) return;
            event.preventDefault();
            this.events.onZoom(Math.sign(event.deltaY) * Math.min(3, Math.abs(event.deltaY) * 0.01));
        };
        const contextMenu = (event: Event) => event.preventDefault();

        window.addEventListener("keydown", keyDown);
        window.addEventListener("keyup", keyUp);
        window.addEventListener("blur", blur);
        canvas.addEventListener("pointerdown", pointerDown);
        canvas.addEventListener("pointermove", pointerMove);
        canvas.addEventListener("pointerup", pointerUp);
        canvas.addEventListener("pointercancel", pointerUp);
        canvas.addEventListener("wheel", wheel, { passive: false });
        canvas.addEventListener("contextmenu", contextMenu);

        this.dispose = () => {
            window.removeEventListener("keydown", keyDown);
            window.removeEventListener("keyup", keyUp);
            window.removeEventListener("blur", blur);
            canvas.removeEventListener("pointerdown", pointerDown);
            canvas.removeEventListener("pointermove", pointerMove);
            canvas.removeEventListener("pointerup", pointerUp);
            canvas.removeEventListener("pointercancel", pointerUp);
            canvas.removeEventListener("wheel", wheel);
            canvas.removeEventListener("contextmenu", contextMenu);
        };
    }

    private releaseStick(): void {
        if (!this.stick) return;
        this.stick = null;
        this.events.onStick(null);
        this.recompute();
    }

    private recompute(): void {
        let x = 0;
        let y = 0;
        for (const code of this.held) {
            const dir = MOVE_KEYS[code];
            if (dir) {
                x += dir[0];
                y += dir[1];
            }
        }
        if (this.stick) {
            x += this.stick.x;
            y += this.stick.y;
        }
        const length = Math.hypot(x, y);
        if (length > 1) {
            x /= length;
            y /= length;
        }
        this.state.move.x = x;
        this.state.move.y = y;
    }

    /** drop anything held — used when a panel takes over the screen */
    release(): void {
        this.held.clear();
        this.state.stroll = false;
        this.releaseStick();
        this.look = null;
        this.recompute();
    }

    destroy(): void {
        this.dispose();
    }
}
