// Browser page zoom is an accident waiting to happen in a terminal: ctrl+wheel — which is
// also what a trackpad pinch arrives as — rescales the whole page, and the layout and xterm's
// fit go with it. This window-level net cancels the pointer-driven paths only. Keyboard zoom
// (Cmd/Ctrl +/-/0) and a phone's finger pinch are deliberate, so they are left working.
type ZoomTarget = Pick<Window, "addEventListener" | "removeEventListener">;

// WebKit's trackpad pinch. Non-standard, absent from WindowEventMap, and Safari does not
// always mirror it as a ctrl-wheel, so the wheel path alone would miss it.
const GESTURE_EVENTS = ["gesturestart", "gesturechange", "gestureend"];

// Chrome treats a window-level wheel listener as passive unless told otherwise, and a passive
// listener's preventDefault() is ignored without so much as a warning.
const WHEEL_OPTIONS: AddEventListenerOptions = { passive: false };

export function installPageZoomGuard(target: ZoomTarget = window): () => void {
  const cancelGesture = (event: Event) => event.preventDefault();
  // Only a ctrl-modified wheel zooms; a plain wheel is scrolling and must reach the terminal.
  const cancelZoomWheel = (event: WheelEvent) => {
    if (event.ctrlKey) event.preventDefault();
  };

  target.addEventListener("wheel", cancelZoomWheel, WHEEL_OPTIONS);
  GESTURE_EVENTS.forEach((type) => target.addEventListener(type, cancelGesture));
  return () => {
    target.removeEventListener("wheel", cancelZoomWheel, WHEEL_OPTIONS);
    GESTURE_EVENTS.forEach((type) => target.removeEventListener(type, cancelGesture));
  };
}
