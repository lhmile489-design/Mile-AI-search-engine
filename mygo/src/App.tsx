import { useEffect, useState } from "react";
import { call } from "mygo-runtime";
import { Greeter, events, type SystemInfo } from "./mygo";

// Report renders to the dev log when the Spike probe service is bound
// (MYGO_SPIKE=1). No-op otherwise — Spike isn't bound in the shipping app.
const report = (msg: string) => call("Spike.Report", `react: ${msg}`).catch(() => {});

// Minimal React shell for G1 task 7: proves React renders inside the MyGo
// WebView2 window and can call a bound Go method, before the real screens are
// ported in G2.
export default function App() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [greeting, setGreeting] = useState("");
  const [name, setName] = useState("");
  const [clock, setClock] = useState("--:--:--");

  useEffect(() => {
    report("mounted");
    Greeter.info()
      .then((i) => {
        setInfo(i);
        report(`Greeter.info ok: ${i.os}/${i.arch} ${i.goVersion}`);
      })
      .catch((e) => report(`Greeter.info failed: ${e}`));
    const off = events.tick.on((t: string) => {
      setClock(new Date(t).toLocaleTimeString());
    });
    return off;
  }, []);

  return (
    <main>
      <h1>Mile AI Search</h1>
      <p className="muted">React + Go bindings in WebView2.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setGreeting(await Greeter.greet(name));
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoFocus
        />
        <button type="submit">Greet</button>
      </form>
      <p className="card">{greeting}</p>
      <p className="muted">
        <span>{info ? `${info.os}/${info.arch} · ${info.goVersion}` : ""}</span>
        {" · "}
        <span>{clock}</span>
      </p>
    </main>
  );
}
