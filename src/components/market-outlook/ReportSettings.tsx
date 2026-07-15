"use client";
import { useRef, useState } from "react";
import { TextInput } from "@/components/ui/FormBits";
import { BrandSettings, saveBrandSettings } from "@/lib/market-outlook/types";

const MAX_PHOTO_BYTES = 800 * 1024;
// The cover's portrait strip renders at up to ~317 CSS px wide by ~741 tall
// (and 2x that in the exported PDF, which snapshots at scale:2) — 300px was
// sized for the old small in-band photo and was visibly upscaled/blurry in
// the new strip. 900px gives real headroom without wasting bytes on photos
// that are already smaller than that.
const MAX_PHOTO_WIDTH = 900;

function downscaleImage(src: Blob | File, maxWidth: number, quality = 1): Promise<{ dataUrl: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode image"));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unsupported"));
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/png", quality);
        // Rough byte size of a data URL: strip the header, base64 is ~4/3 bytes/char.
        const bytes = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
        resolve({ dataUrl, bytes });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(src);
  });
}

// Shrinks width in steps until under MAX_PHOTO_BYTES or we hit a floor.
async function downscaleUnderLimit(src: Blob | File, maxBytes: number): Promise<string> {
  let width = MAX_PHOTO_WIDTH;
  for (let i = 0; i < 5; i++) {
    const { dataUrl, bytes } = await downscaleImage(src, width);
    if (bytes <= maxBytes || width <= 120) return dataUrl;
    width = Math.round(width * 0.75);
  }
  return (await downscaleImage(src, 120)).dataUrl;
}

// Controlled: parent owns the draft `value` and only "commits" it into the
// live report (Update Input / Refresh PDF) when its buttons are clicked —
// keystrokes here update the form + localStorage but don't re-render pages
// on every character.
export function ReportSettings({
  value,
  onChange,
}: {
  value: BrandSettings;
  onChange: (s: BrandSettings) => void;
}) {
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  function update(patch: Partial<BrandSettings>) {
    const next = { ...value, ...patch };
    saveBrandSettings(next);
    onChange(next);
  }

  async function handlePhotoFile(file: File | undefined) {
    setPhotoError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Please choose an image file");
      return;
    }
    setPhotoBusy(true);
    try {
      const { removeBackground } = await import("@imgly/background-removal");
      const cutout = await removeBackground(file, { model: "isnet_quint8" });
      const dataUrl = await downscaleUnderLimit(cutout, MAX_PHOTO_BYTES);
      update({ photoDataUrl: dataUrl });
    } catch {
      setPhotoError("Could not process image — try a clearer photo or a smaller file");
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-[10px] text-dim">
          FIRM NAME
          <TextInput
            value={value.firmName}
            onChange={(e) => update({ firmName: e.target.value })}
            placeholder="Your firm"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-dim">
          ADVISER&apos;S NAME
          {/* 2 rows x 11 mono chars (22 total) — matches how the name wraps
              on the cover/page6 contact band. Monospace + a ch-based width
              is what makes "11 per row" exact; a proportional font can't
              guarantee a fixed character count per line. */}
          <textarea
            value={value.adviserName}
            onChange={(e) => update({ adviserName: e.target.value.replace(/\n/g, "").slice(0, 22) })}
            placeholder="Your name"
            maxLength={22}
            rows={2}
            wrap="hard"
            className="bg-grid border border-border px-2 py-1 text-text placeholder:text-dim font-mono resize-none break-all"
            style={{ width: "11ch", boxSizing: "content-box" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-dim">
          RANK
          <TextInput
            value={value.adviserTitle}
            onChange={(e) => update({ adviserTitle: e.target.value })}
            placeholder="Associate Director"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-dim">
          CONTACT NUMBER
          <TextInput
            value={value.phone}
            onChange={(e) => update({ phone: e.target.value })}
            placeholder="+65 9xxx xxxx"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-dim">
          EMAIL
          <TextInput
            value={value.email}
            onChange={(e) => update({ email: e.target.value })}
            placeholder="you@firm.com"
          />
        </label>
      </div>

      <div className="flex flex-col gap-3">
        {value.photoDataUrl ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={value.photoDataUrl}
                alt="Adviser photo preview"
                className="h-10 w-8 object-cover border border-border bg-grid"
                style={{
                  objectPosition: `center ${value.photoPosY}%`,
                  transform: `scale(${value.photoScale / 100})`,
                  opacity: value.photoOpacity / 100,
                }}
              />
              <button
                onClick={() => update({ photoDataUrl: null, photoPosY: 50, photoScale: 100, photoOpacity: 78 })}
                className="text-red hover:text-amber text-[10px]"
              >
                ✕ REMOVE PHOTO
              </button>
            </div>
            <label className="flex items-center gap-2 text-[10px] text-dim">
              <span className="w-14">POSITION ↕</span>
              <input
                type="range"
                min={0}
                max={100}
                value={value.photoPosY}
                onChange={(e) => update({ photoPosY: Number(e.target.value) })}
                className="flex-1"
              />
            </label>
            <label className="flex items-center gap-2 text-[10px] text-dim">
              <span className="w-14">ZOOM</span>
              <input
                type="range"
                min={80}
                max={160}
                value={value.photoScale}
                onChange={(e) => update({ photoScale: Number(e.target.value) })}
                className="flex-1"
              />
            </label>
            <label className="flex items-center gap-2 text-[10px] text-dim">
              <span className="w-14">OPACITY</span>
              <input
                type="range"
                min={30}
                max={100}
                value={value.photoOpacity}
                onChange={(e) => update({ photoOpacity: Number(e.target.value) })}
                className="flex-1"
              />
              <span className="w-8 text-right">{value.photoOpacity}%</span>
            </label>
            <div className="text-dim text-[9px]">Blends the portrait into the cover photo behind it.</div>
          </div>
        ) : (
          <button
            onClick={() => photoInputRef.current?.click()}
            disabled={photoBusy}
            onDragOver={(e) => {
              e.preventDefault();
              if (!photoBusy) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (!photoBusy) handlePhotoFile(e.dataTransfer.files?.[0]);
            }}
            className={`w-full min-h-[160px] flex items-center justify-center text-center px-8 py-10 border-2 border-dashed rounded text-[12px] leading-relaxed transition-colors ${
              photoBusy
                ? "border-border text-dim cursor-default"
                : dragOver
                  ? "border-cyan text-cyan bg-grid"
                  : "border-border text-dim hover:text-cyan hover:border-cyan"
            }`}
          >
            {photoBusy
              ? "REMOVING BACKGROUND…"
              : dragOver
                ? "DROP TO UPLOAD"
                : "UPLOAD OR DRAG ADVISER PHOTO — background removed automatically"}
          </button>
        )}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handlePhotoFile(e.target.files?.[0])}
        />
        {photoError && <span className="text-red text-[10px]">{photoError}</span>}
      </div>
      <div className="text-dim text-[9px]">
        Background removal + resizing runs in your browser — photo never sent to any server. First upload may take a
        few seconds while the model downloads.
      </div>
    </div>
  );
}
