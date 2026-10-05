// A recording stand-in for db.ts's `sql`, shared by the briefings store and
// entry-point tests. Every statement is recorded as text plus params, and its
// result comes from the first scripted reply whose key the text contains.
export interface Call {
  text: string;
  params: unknown[];
  via: "tag" | "unsafe";
}

type Reply = unknown[] | Error | ((call: Call) => unknown[]);

export function makeFakeSql() {
  const calls: Call[] = [];
  const replies: { key: string; reply: Reply }[] = [];
  const state = { begins: 0, ended: false, releases: 0, reserveError: null as Error | null };

  function answer(call: Call): unknown[] {
    calls.push(call);
    const hit = replies.find((r) => call.text.includes(r.key));
    if (!hit) return [];
    if (hit.reply instanceof Error) throw hit.reply;
    return typeof hit.reply === "function" ? hit.reply(call) : hit.reply;
  }
  const tag = async (strings: TemplateStringsArray, ...params: unknown[]) =>
    answer({ text: strings.reduce((acc, s, i) => acc + (i ? `$${i}` : "") + s, ""), params, via: "tag" });
  const unsafe = async (text: string, params: unknown[] = []) => answer({ text, params, via: "unsafe" });

  const sql = Object.assign(tag, {
    unsafe,
    begin: async <T>(fn: (tx: typeof tag & { unsafe: typeof unsafe }) => Promise<T>): Promise<T> => {
      state.begins++;
      return fn(Object.assign(tag, { unsafe }));
    },
    reserve: async () => {
      if (state.reserveError) throw state.reserveError;
      return Object.assign(tag, { release: () => void state.releases++ });
    },
    end: async () => void (state.ended = true),
  });

  return {
    sql,
    calls,
    state,
    script: (key: string, reply: Reply) => void replies.push({ key, reply }),
    reset: () => {
      calls.length = 0;
      replies.length = 0;
      Object.assign(state, { begins: 0, ended: false, releases: 0, reserveError: null });
    },
  };
}
