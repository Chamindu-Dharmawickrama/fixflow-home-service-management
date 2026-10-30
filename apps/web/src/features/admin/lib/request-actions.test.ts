import { RequestAction } from "@fixflow/shared";
import { describe, expect, it } from "vitest";

import { REQUEST_ACTION_LABELS, splitActions } from "./request-actions";

const { START_REVIEW, REOPEN, CANCEL } = RequestAction;

describe("splitActions", () => {
  it.each([
    {
      name: "a new request",
      actions: [START_REVIEW, CANCEL],
      primary: START_REVIEW,
      menu: [CANCEL],
    },
    { name: "a declined request", actions: [REOPEN, CANCEL], primary: REOPEN, menu: [CANCEL] },
    {
      name: "a request that can only be cancelled",
      actions: [CANCEL],
      primary: undefined,
      menu: [CANCEL],
    },
    { name: "a request with nothing left to do", actions: [], primary: undefined, menu: [] },
    { name: "only the main step", actions: [START_REVIEW], primary: START_REVIEW, menu: [] },
  ])("offers $name: main button and menu", ({ actions, primary, menu }) => {
    expect(splitActions(actions)).toEqual({ primary, menu });
  });

  it("puts the first action that is not destructive on the button, whatever the order", () => {
    expect(splitActions([CANCEL, START_REVIEW])).toEqual({ primary: START_REVIEW, menu: [CANCEL] });
  });

  it("keeps the server's order in the menu", () => {
    expect(splitActions([START_REVIEW, REOPEN, CANCEL]).menu).toEqual([REOPEN, CANCEL]);
  });

  it("does not change what it was given", () => {
    const actions = [START_REVIEW, CANCEL];
    splitActions(actions);
    expect(actions).toEqual([START_REVIEW, CANCEL]);
  });
});

describe("REQUEST_ACTION_LABELS", () => {
  it("names every action", () => {
    for (const action of Object.values(RequestAction)) {
      expect(REQUEST_ACTION_LABELS[action]).toMatch(/\S/);
    }
  });
});
