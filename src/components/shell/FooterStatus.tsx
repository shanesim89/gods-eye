export function FooterStatus() {
  return (
    <div className="bg-bg border-t border-border px-3.5 py-1.5 text-[10px] text-dim flex justify-between">
      <div>
        STATUS: <span className="text-green">● CONNECTED</span> &nbsp; · &nbsp;
        FX FEED: <span className="text-green">LIVE</span> &nbsp; · &nbsp; MKT FEED: <span className="text-green">LIVE</span>
      </div>
      <div>F1 HELP &nbsp; F2 GURU &nbsp; F3 GOALS &nbsp; ESC LOGOUT</div>
    </div>
  );
}
