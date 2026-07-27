import { computed, ref } from "vue";
import { GITHUB_REPO_URL, parseStarState } from "../../common/githubRepo";

// The header's "star this project on GitHub" button. The point of the whole feature is that it
// can go away for good — a permanent ad in the user's own workspace is the failure mode being
// designed around — so two things retire it: the repo is already starred, or the user dealt
// with it once in this browser. A retired button costs nothing, not even the state request.
const STORAGE_KEY = "github_star_done";
// Keep the button up, confirmed, for a moment after starring. Vanishing on the click itself
// reads as "nothing happened".
const CONFIRM_MS = 1500;

// "unknown" until the server answers, so an already-starred user never sees it flash. "unavailable"
// is `gh` being unable to tell us: the button degrades to a plain link to the repo page.
type StarState = "unknown" | "unstarred" | "starred" | "unavailable";

const done = ref(localStorage.getItem(STORAGE_KEY) === "1");
const state = ref<StarState>("unknown");
const confirming = ref(false);
let asked = false;

function retire(): void {
  localStorage.setItem(STORAGE_KEY, "1");
  done.value = true;
}

function toState(starred: boolean | null): StarState {
  if (starred === null) return "unavailable";
  return starred ? "starred" : "unstarred";
}

async function readState(): Promise<void> {
  try {
    const res = await fetch("/api/github/star");
    const starred = res.ok ? parseStarState(await res.json()) : null;
    state.value = toState(starred);
    if (starred === true) retire();
  } catch {
    state.value = "unavailable";
  }
}

async function postStar(): Promise<boolean> {
  try {
    const res = await fetch("/api/github/star", { method: "POST" });
    return res.ok && parseStarState(await res.json()) === true;
  } catch {
    return false;
  }
}

function confirmStarred(): void {
  state.value = "starred";
  confirming.value = true;
  setTimeout(() => {
    confirming.value = false;
    retire();
  }, CONFIRM_MS);
}

export function useGithubStar() {
  if (!asked && !done.value) {
    asked = true;
    void readState();
  }

  const visible = computed(() => !done.value && (confirming.value || state.value === "unstarred" || state.value === "unavailable"));
  const title = computed(() => {
    if (confirming.value) return "Starred. Thank you!";
    return state.value === "unavailable" ? "Open MulmoTerminal on GitHub" : "Star MulmoTerminal on GitHub";
  });

  async function activate(): Promise<void> {
    // A second click inside the confirmation window would otherwise fall through to the link
    // branch and open github.com on someone who just successfully starred.
    if (confirming.value) return;
    if (state.value !== "unstarred") {
      window.open(GITHUB_REPO_URL, "_blank", "noopener");
      retire();
      return;
    }
    if (await postStar()) return confirmStarred();
    // `gh` worked at read time and not now (auth expired, network died). Become the link: the
    // next click opens the page synchronously, which no popup blocker objects to.
    state.value = "unavailable";
  }

  return { visible, confirming, title, activate };
}
