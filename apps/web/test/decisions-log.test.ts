import { describe, expect, it } from "vitest";
import {
  csvCell,
  csvRow,
  decisionRowsToCsv,
  decisionToCsvRow,
  escapeLikePattern,
  outcomeLabel,
  type DecisionLogEntry,
} from "../src/lib/decisions-log.js";

const entry: DecisionLogEntry = {
  id: "0c38f4e2-0000-4000-8000-000000000001",
  createdAt: new Date("2026-10-10T12:34:56Z"),
  leadEmail: "jane@corp.com",
  inputs: { form: { name: "Jane Doe" }, crm: {} },
  matchedRule: "Enterprise",
  outcome: {
    kind: "route_team",
    teamId: "6f9619ff-8b86-d011-b42d-00c04fc964ff",
    userId: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
    strategy: "round_robin",
    reason: "Matched rule Enterprise. Team: Enterprise. Round robin picked Alice.",
  },
  latencyMs: 12,
  formSlug: "book-a-demo",
  repName: "Alice Chen",
  teamName: "Enterprise",
};

describe("escapeLikePattern", () => {
  it("escapes LIKE wildcards and the escape character", () => {
    expect(escapeLikePattern("50%")).toBe("50\\%");
    expect(escapeLikePattern("under_score")).toBe("under\\_score");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
    expect(escapeLikePattern("plain")).toBe("plain");
  });
});

describe("outcomeLabel", () => {
  it("labels every outcome kind", () => {
    expect(outcomeLabel("route_user")).toBe("Routed to rep");
    expect(outcomeLabel("route_team")).toBe("Routed to team");
    expect(outcomeLabel("self_serve_link")).toBe("Self-serve link");
    expect(outcomeLabel("fallback_queue")).toBe("Fallback queue");
  });
});

describe("csvCell", () => {
  it("leaves plain values untouched", () => {
    expect(csvCell("jane@corp.com")).toBe("jane@corp.com");
    expect(csvCell(12)).toBe("12");
  });

  it("quotes cells with commas, quotes, or newlines and doubles embedded quotes", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralizes formula injection in string cells", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("@x")).toBe("'@x");
    expect(csvCell("\t=cmd")).toBe("'\t=cmd");
    expect(csvCell("\r=cmd")).toBe(`"'\r=cmd"`);
  });

  it("does not prefix numbers that start with a sign", () => {
    expect(csvCell(-5)).toBe("-5");
  });
});

describe("csvRow", () => {
  it("joins cells with commas", () => {
    expect(csvRow(["a", "b,c", 3])).toBe('a,"b,c",3');
  });
});

describe("decisionToCsvRow", () => {
  it("maps an entry to the flat row shape", () => {
    const row = decisionToCsvRow(entry);
    expect(row.decidedAt.toISOString()).toBe("2026-10-10T12:34:56.000Z");
    expect(row.outcomeKind).toBe("route_team");
    expect(row.repName).toBe("Alice Chen");
    expect(row.reason).toBe(entry.outcome.reason);
  });
});

describe("decisionRowsToCsv", () => {
  it("starts with the header and uses CRLF line endings", () => {
    const csv = decisionRowsToCsv([decisionToCsvRow(entry)]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      "decided_at,lead_email,form,matched_rule,outcome,rep,team,latency_ms,reason",
    );
    expect(lines[1]).toContain("2026-10-10T12:34:56.000Z");
    expect(lines[1]).toContain("jane@corp.com");
    expect(lines[1]).toContain("Enterprise");
    expect(lines[1]).toContain("route_team");
    expect(lines[1]).toContain("Alice Chen");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("renders null rule as fallback and missing names as empty cells", () => {
    const csv = decisionRowsToCsv([
      decisionToCsvRow({
        ...entry,
        matchedRule: null,
        leadEmail: null,
        formSlug: null,
        repName: null,
        teamName: null,
      }),
    ]);
    const [, line] = csv.split("\r\n");
    const cells = line!.split(",");
    expect(cells[3]).toBe("fallback");
    expect(cells[1]).toBe("");
    expect(cells[2]).toBe("");
    expect(cells[5]).toBe("");
    expect(cells[6]).toBe("");
  });

  it("quotes reason cells that contain commas", () => {
    const csv = decisionRowsToCsv([
      decisionToCsvRow({
        ...entry,
        outcome: { ...entry.outcome, reason: "No rule matched, sent to the queue." },
      }),
    ]);
    expect(csv).toContain('"No rule matched, sent to the queue."');
  });

  it("emits only the header for an empty log", () => {
    const csv = decisionRowsToCsv([]);
    expect(csv).toBe(
      "decided_at,lead_email,form,matched_rule,outcome,rep,team,latency_ms,reason\r\n",
    );
  });
});
