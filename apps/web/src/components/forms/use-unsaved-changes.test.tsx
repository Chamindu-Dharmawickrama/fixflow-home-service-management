import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { useUnsavedChangesGuard } from "./use-unsaved-changes";

const spies: { stop: () => void }[] = [];

beforeEach(() => {
  push.mockReset();
  window.history.replaceState(null, "", "/app/settings/business");
});

afterEach(() => {
  // Also after a failing test, so a leftover listener cannot cancel clicks in the next one.
  for (const spy of spies.splice(0)) spy.stop();
});

/**
 * A page with links, a guard and a way to read what the guard says. Plain anchors on purpose: the
 * guard listens for clicks on any link, and a router-less test needs no `Link` component.
 */
function Harness({ active }: { active: boolean }) {
  const guard = useUnsavedChangesGuard(active);
  return (
    <div>
      {/* eslint-disable @next/next/no-html-link-for-pages */}
      <a href="/app/settings/services">Services</a>
      <a href="/app/settings/services?status=archived#top">Archived</a>
      {/* eslint-enable @next/next/no-html-link-for-pages */}
      <a href="https://example.test/elsewhere">Other site</a>
      <a href="/app/settings/business#details">Same page</a>
      <a href="/app/dashboard" target="_blank">
        New tab
      </a>
      <a href="/app/export.csv" download>
        Download
      </a>
      <p data-testid="pending">{guard.pendingHref ?? "none"}</p>
      <button onClick={guard.stay}>Stay</button>
      <button onClick={guard.leave}>Leave</button>
    </div>
  );
}

/**
 * jsdom cannot navigate, so a click that would is cancelled here, after the guard has had its say.
 * It listens in the capture phase too, registered after the guard's own listener, because the guard
 * stops propagation when it intercepts and a bubble-phase listener would never hear about it.
 */
function cancelNavigation() {
  const seen: boolean[] = [];
  const listener = (event: MouseEvent) => {
    seen.push(event.defaultPrevented);
    event.preventDefault();
  };
  document.addEventListener("click", listener, true);
  const spy = {
    /** Did the guard itself cancel the last link click? */
    guardPrevented: () => seen.at(-1) === true,
    stop: () => {
      document.removeEventListener("click", listener, true);
    },
  };
  spies.push(spy);
  return spy;
}

describe("useUnsavedChangesGuard: links", () => {
  it("intercepts a link to another page of the app and remembers where it went", async () => {
    render(<Harness active />);
    const spy = cancelNavigation();

    await userEvent.click(screen.getByRole("link", { name: "Services" }));

    expect(screen.getByTestId("pending")).toHaveTextContent("/app/settings/services");
    expect(spy.guardPrevented()).toBe(true);
  });

  it("keeps the query string and fragment of the destination", async () => {
    render(<Harness active />);
    cancelNavigation();

    await userEvent.click(screen.getByRole("link", { name: "Archived" }));

    expect(screen.getByTestId("pending")).toHaveTextContent(
      "/app/settings/services?status=archived#top",
    );
  });

  it("does nothing while the form is clean", async () => {
    render(<Harness active={false} />);
    const spy = cancelNavigation();

    await userEvent.click(screen.getByRole("link", { name: "Services" }));

    expect(screen.getByTestId("pending")).toHaveTextContent("none");
    expect(spy.guardPrevented()).toBe(false);
  });

  it.each([
    ["a link to another site", "Other site"],
    ["a link to the same page", "Same page"],
    ["a link that opens a new tab", "New tab"],
    ["a download", "Download"],
  ])("lets %s through", async (_name, label) => {
    render(<Harness active />);
    const spy = cancelNavigation();

    await userEvent.click(screen.getByRole("link", { name: label }));

    expect(screen.getByTestId("pending")).toHaveTextContent("none");
    expect(spy.guardPrevented()).toBe(false);
  });

  it("lets a modified click through: the person is opening a new tab", async () => {
    render(<Harness active />);
    const spy = cancelNavigation();

    // One instance for all three calls: the held Control key is remembered by the instance.
    const user = userEvent.setup();
    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("link", { name: "Services" }));
    await user.keyboard("{/Control}");

    expect(screen.getByTestId("pending")).toHaveTextContent("none");
    expect(spy.guardPrevented()).toBe(false);
  });

  it("stays on the page when asked, and the next click is caught again", async () => {
    render(<Harness active />);
    cancelNavigation();

    await userEvent.click(screen.getByRole("link", { name: "Services" }));
    await userEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(screen.getByTestId("pending")).toHaveTextContent("none");
    expect(push).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("link", { name: "Services" }));
    expect(screen.getByTestId("pending")).toHaveTextContent("/app/settings/services");
  });

  it("goes where the person was heading when they choose to leave", async () => {
    render(<Harness active />);
    cancelNavigation();

    await userEvent.click(screen.getByRole("link", { name: "Services" }));
    await userEvent.click(screen.getByRole("button", { name: "Leave" }));

    expect(push).toHaveBeenCalledExactlyOnceWith("/app/settings/services");
    expect(screen.getByTestId("pending")).toHaveTextContent("none");
  });

  it("does not navigate anywhere when there is nothing pending", async () => {
    render(<Harness active />);

    await userEvent.click(screen.getByRole("button", { name: "Leave" }));

    expect(push).not.toHaveBeenCalled();
  });

  it("stops listening when the form becomes clean or goes away", async () => {
    const { rerender, unmount } = render(<Harness active />);
    rerender(<Harness active={false} />);
    const spy = cancelNavigation();

    await userEvent.click(screen.getByRole("link", { name: "Services" }));
    expect(spy.guardPrevented()).toBe(false);

    rerender(<Harness active />);
    unmount();
    document.body.innerHTML = '<a href="/app/settings/services">Late</a>';
    await userEvent.click(screen.getByRole("link", { name: "Late" }));
    expect(spy.guardPrevented()).toBe(false);
  });
});

describe("useUnsavedChangesGuard: closing the tab", () => {
  function fireBeforeUnload(): BeforeUnloadEvent {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event;
  }

  it("asks the browser to confirm while there are unsaved changes", () => {
    renderHook(() => useUnsavedChangesGuard(true));

    expect(fireBeforeUnload().defaultPrevented).toBe(true);
  });

  it("does not ask when the form is clean", () => {
    renderHook(() => useUnsavedChangesGuard(false));

    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });

  it("stops asking once the changes are saved", () => {
    const { rerender } = renderHook(({ active }) => useUnsavedChangesGuard(active), {
      initialProps: { active: true },
    });
    expect(fireBeforeUnload().defaultPrevented).toBe(true);

    act(() => {
      rerender({ active: false });
    });

    expect(fireBeforeUnload().defaultPrevented).toBe(false);
  });
});
