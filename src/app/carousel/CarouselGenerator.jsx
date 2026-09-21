'use client';

import { useEffect, useRef } from 'react';

const STICKERS = [
  "/stickers/fullbody_01.png",
  "/stickers/fullbody_02.png",
  "/stickers/fullbody_03.png",
  "/stickers/fullbody_04.png",
  "/stickers/fullbody_05.png",
  "/stickers/fullbody_06.png",
  "/stickers/fullbody_07.png",
  "/stickers/fullbody_09.png",
  "/stickers/fullbody_10.png",
  "/stickers/fullbody_13.png",
  "/stickers/fullbody_14.png",
  "/stickers/fullbody_15.png",
  "/stickers/fullbody_16.png",
  "/stickers/fullbody_17.png",
  "/stickers/fullbody_18.png",
  "/stickers/fullbody_19.png",
  "/stickers/fullbody_20.png",
  "/stickers/fullbody_21.png",
  "/stickers/fullbody_22.png",
  "/stickers/fullbody_23.png",
  "/stickers/fullbody_24.png",
  "/stickers/fullbody_25.png",
  "/stickers/headshot_01.png",
  "/stickers/headshot_02.png",
  "/stickers/headshot_03.png",
  "/stickers/headshot_04.png",
  "/stickers/headshot_05.png",
  "/stickers/headshot_06.png",
  "/stickers/headshot_07.png",
  "/stickers/headshot_08.png",
  "/stickers/headshot_09.png",
  "/stickers/headshot_10.png"
];
const LOGO = "/logo-watermark.png";

export default function CarouselGenerator() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const CANVAS_W = 1080, CANVAS_H = 1350;
    const BG = "#F7F3EC";
    const INK = "#2B2B2B";
    const LEFT_MARGIN = Math.round(CANVAS_W*0.245);
    const COL_WIDTH = Math.round(CANVAS_W*0.51);
    const FIXED_PHRASE_LINES = ["In case your boss never tell you", "let me tell you!"];
    const IMG_ASPECT_RATIO = 2.7; // width/height — every attached image (slides 1-5) uses this same frame

    const ICONS = ["none","balance","growth","coin","clock","chat","handshake","compass","shield"];

    // ---------- state ----------
    let slides = []; // {role:'opening'|'content'|'closing', style:'punchy'|'paragraph', text:'', icon:'none', imageData:null}
    let renderedSlides = []; // {dataUrl, index}
    let currentPreviewIndex = 0;
    let chosenStickerIdx = null;

    function defaultSlides(){
      return [
        {role:'opening', style:'punchy', text:'', icon:'none', imageData:null, imagePosition:'below', ctaText:''},
        {role:'content', style:'punchy', text:'', icon:'none', imageData:null, imagePosition:'below', ctaText:''},
        {role:'content', style:'punchy', text:'', icon:'none', imageData:null, imagePosition:'below', ctaText:''},
        {role:'closing', style:'punchy', text:'', icon:'none', imageData:null, imagePosition:'below', ctaText:''},
      ];
    }

    // ---------- step 1: generate breakdown ----------
    document.getElementById('btnManual').addEventListener('click', ()=>{
      slides = defaultSlides();
      openEditStep();
    });

    document.getElementById('btnGenerate').addEventListener('click', async ()=>{
      const raw = document.getElementById('rawInput').value.trim();
      const statusEl = document.getElementById('genStatus');
      if(!raw){ statusEl.textContent = "Paste a thought first."; return; }
      statusEl.textContent = "Thinking...";
      statusEl.classList.add('active');
      document.getElementById('btnGenerate').disabled = true;

      try{
        const res = await fetch('/api/generate-slides', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({rawThoughts: raw})
        });
        if(!res.ok) throw new Error("request failed");
        const data = await res.json();
        if(!data || !Array.isArray(data.slides) || data.slides.length < 3){
          throw new Error("bad shape");
        }
        let rawSlides = data.slides.slice(0, 5); // hard cap at 5 slides
        slides = rawSlides.map((s,i)=>({
          role: s.role || (i===0?'opening': (i===rawSlides.length-1?'closing':'content')),
          style: s.style === 'paragraph' ? 'paragraph' : 'punchy',
          text: (s.text||'').trim(),
          icon: ICONS.includes(s.icon) ? s.icon : 'none',
          imageData: null,
          imagePosition: 'below',
          ctaText: ''
        }));
        slides[0].role = 'opening';
        slides[slides.length-1].role = 'closing';
        statusEl.textContent = "Breakdown ready — edit below.";
      }catch(e){
        statusEl.textContent = "Couldn't get a breakdown — starting manual instead.";
        slides = defaultSlides();
      }
      statusEl.classList.remove('active');
      document.getElementById('btnGenerate').disabled = false;
      openEditStep();
    });

    function openEditStep(){
      document.getElementById('editStep').style.display = 'grid';
      renderSlideList();
      document.getElementById('editStep').scrollIntoView({behavior:'smooth', block:'start'});
    }

    // ---------- step 2: edit slides ----------
    function countParagraphs(){
      return slides.filter(s=>s.style==='paragraph').length;
    }

    function renderSlideList(){
      const list = document.getElementById('slideList');
      list.innerHTML = '';
      slides.forEach((s, idx)=>{
        const card = document.createElement('div');
        card.className = 'slide-card';

        const tagText = s.role === 'opening' ? 'Slide 1 — Opening (after your signature line)'
          : s.role === 'closing' ? `Slide ${idx+1} — Closing quote`
          : `Slide ${idx+1} — Content`;

        card.innerHTML = `
          <div class="top-row">
            <span class="slide-tag">${tagText}</span>
          </div>
          <textarea data-idx="${idx}" class="slide-text" placeholder="${s.role==='closing' ? 'Your in-your-face closing line...' : 'Slide text...'}">${escapeHtml(s.text)}</textarea>
          <div class="slide-controls">
            ${s.role !== 'closing' ? `
            <div class="ctrl-group">
              <label>Style</label>
              <select class="style-select" data-idx="${idx}">
                <option value="punchy" ${s.style==='punchy'?'selected':''}>Punchy line</option>
                <option value="paragraph" ${s.style==='paragraph'?'selected':''}>Paragraph</option>
              </select>
            </div>` : ''}
            ${s.role !== 'closing' ? `
            <div class="ctrl-group">
              <label>Icon</label>
              <select class="icon-select" data-idx="${idx}">
                ${ICONS.map(i=>`<option value="${i}" ${s.icon===i?'selected':''}>${i==='none'?'None':i}</option>`).join('')}
              </select>
            </div>` : ''}
            <div class="ctrl-group img-thumb">
              <input type="file" accept="image/*" class="img-upload" data-idx="${idx}">
              ${s.imageData ? `<img src="${s.imageData}"><button class="small ghost img-recrop" data-idx="${idx}">adjust crop</button><button class="small ghost img-remove" data-idx="${idx}">remove</button>` : ''}
            </div>
            ${s.imageData ? `
            <div class="ctrl-group">
              <label>Image sits</label>
              <select class="imgpos-select" data-idx="${idx}">
                <option value="below" ${s.imagePosition!=='above'?'selected':''}>Below text</option>
                <option value="above" ${s.imagePosition==='above'?'selected':''}>Above text</option>
              </select>
            </div>` : ''}
          </div>
          <p class="split-indicator" data-idx="${idx}" style="margin:8px 0 0;font-size:12px;"></p>
          ${s.role==='closing' ? `
          <div style="margin-top:12px;">
            <label style="font-size:13px;color:var(--ink-soft);display:block;margin-bottom:6px;">CTA in the speech bubble (sticker also appears on this slide)</label>
            <textarea data-idx="${idx}" class="slide-cta" placeholder="e.g. Follow for more!" style="min-height:44px;">${escapeHtml(s.ctaText||'')}</textarea>
          </div>` : ''}
        `;
        list.appendChild(card);
      });

      list.querySelectorAll('.slide-cta').forEach(el=>{
        el.addEventListener('input', e=>{
          slides[+e.target.dataset.idx].ctaText = e.target.value;
        });
      });

      list.querySelectorAll('.slide-text').forEach(el=>{
        el.addEventListener('input', e=>{
          const idx = +e.target.dataset.idx;
          slides[idx].text = e.target.value;
          updateSplitIndicator(idx);
        });
      });
      slides.forEach((s,idx)=>updateSplitIndicator(idx));
      list.querySelectorAll('.style-select').forEach(el=>{
        el.addEventListener('change', e=>{
          const idx = +e.target.dataset.idx;
          if(e.target.value === 'paragraph' && countParagraphs() >= 1 && slides[idx].style !== 'paragraph'){
            slides.forEach((s,i)=>{ if(i!==idx) s.style='punchy'; });
          }
          slides[idx].style = e.target.value;
          renderSlideList();
        });
      });
      list.querySelectorAll('.icon-select').forEach(el=>{
        el.addEventListener('change', e=>{
          slides[+e.target.dataset.idx].icon = e.target.value;
        });
      });
      list.querySelectorAll('.img-upload').forEach(el=>{
        el.addEventListener('change', e=>{
          const idx = +e.target.dataset.idx;
          const file = e.target.files[0];
          if(!file) return;
          const reader = new FileReader();
          reader.onload = ()=>{ openCropper(idx, reader.result); };
          reader.readAsDataURL(file);
          e.target.value = ''; // allow re-selecting the same file later
        });
      });
      list.querySelectorAll('.img-recrop').forEach(el=>{
        el.addEventListener('click', e=>{
          const idx = +e.target.dataset.idx;
          openCropper(idx, slides[idx].imageData);
        });
      });
      list.querySelectorAll('.imgpos-select').forEach(el=>{
        el.addEventListener('change', e=>{
          slides[+e.target.dataset.idx].imagePosition = e.target.value;
        });
      });
      list.querySelectorAll('.img-remove').forEach(el=>{
        el.addEventListener('click', e=>{
          slides[+e.target.dataset.idx].imageData = null;
          renderSlideList();
        });
      });
    }

    function updateSplitIndicator(idx){
      const s = slides[idx];
      const el = document.querySelector(`.split-indicator[data-idx="${idx}"]`);
      if(!el) return;
      const wordCount = (s.text||'').trim().split(/\s+/).filter(Boolean).length;
      if(s.role === 'closing'){
        el.textContent = '';
        return;
      }
      if(s.imageData && wordCount > 25){
        el.textContent = `✓ Splitting into 2 parts (${wordCount} words) — image placed in the middle`;
        el.style.color = 'var(--ink)';
      } else if(s.imageData){
        el.textContent = `${wordCount}/25 words — attach won't split until it passes 25 words`;
        el.style.color = 'var(--ink-soft)';
      } else {
        el.textContent = '';
      }
    }

    function escapeHtml(str){
      const d = document.createElement('div');
      d.innerText = str;
      return d.innerHTML;
    }

    // ---------- image cropper (fixed IMG_ASPECT_RATIO frame for every slide's image) ----------
    let cropState = null; // {idx, img, boxW, boxH, baseScale, panX, panY, dragging, startX, startY, startPanX, startPanY}

    function openCropper(idx, srcDataUrl){
      const img = new Image();
      img.onload = ()=>{
        const modal = document.getElementById('cropModal');
        const stage = document.getElementById('cropStage');
        modal.style.display = 'flex';
        const boxW = stage.clientWidth || 360;
        const boxH = Math.round(boxW / IMG_ASPECT_RATIO);
        stage.style.height = boxH + 'px';
        const canvas = document.getElementById('cropCanvas');
        canvas.width = boxW; canvas.height = boxH;
        const baseScale = Math.max(boxW/img.width, boxH/img.height);
        cropState = { idx, img, boxW, boxH, baseScale, panX:0, panY:0, dragging:false };
        document.getElementById('cropZoom').value = 100;
        drawCropPreview();
      };
      img.src = srcDataUrl;
    }

    function clampPan(){
      const s = cropState;
      const zoom = document.getElementById('cropZoom').value/100;
      const scale = s.baseScale*zoom;
      const drawW = s.img.width*scale, drawH = s.img.height*scale;
      const maxPanX = Math.max(0,(drawW - s.boxW)/2);
      const maxPanY = Math.max(0,(drawH - s.boxH)/2);
      s.panX = Math.max(-maxPanX, Math.min(maxPanX, s.panX));
      s.panY = Math.max(-maxPanY, Math.min(maxPanY, s.panY));
    }

    function drawCropPreview(){
      const s = cropState;
      if(!s) return;
      clampPan();
      const zoom = document.getElementById('cropZoom').value/100;
      const scale = s.baseScale*zoom;
      const drawW = s.img.width*scale, drawH = s.img.height*scale;
      const canvas = document.getElementById('cropCanvas');
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0,0,s.boxW,s.boxH);
      const x = s.boxW/2 - drawW/2 + s.panX;
      const y = s.boxH/2 - drawH/2 + s.panY;
      ctx.drawImage(s.img, x, y, drawW, drawH);
    }

    document.getElementById('cropZoom').addEventListener('input', drawCropPreview);

    (function setupCropDrag(){
      const stage = document.getElementById('cropStage');
      stage.addEventListener('pointerdown', e=>{
        if(!cropState) return;
        cropState.dragging = true;
        cropState.startX = e.clientX; cropState.startY = e.clientY;
        cropState.startPanX = cropState.panX; cropState.startPanY = cropState.panY;
        stage.setPointerCapture(e.pointerId);
        stage.style.cursor = 'grabbing';
      });
      stage.addEventListener('pointermove', e=>{
        if(!cropState || !cropState.dragging) return;
        cropState.panX = cropState.startPanX + (e.clientX - cropState.startX);
        cropState.panY = cropState.startPanY + (e.clientY - cropState.startY);
        drawCropPreview();
      });
      ['pointerup','pointercancel','pointerleave'].forEach(evt=>{
        stage.addEventListener(evt, ()=>{
          if(cropState) cropState.dragging = false;
          stage.style.cursor = 'grab';
        });
      });
    })();

    document.getElementById('cropCancel').addEventListener('click', ()=>{
      document.getElementById('cropModal').style.display = 'none';
      cropState = null;
    });

    document.getElementById('cropConfirm').addEventListener('click', ()=>{
      if(!cropState) return;
      const s = cropState;
      const zoom = document.getElementById('cropZoom').value/100;
      const scale = s.baseScale*zoom;
      // render at a higher fixed output resolution for crisp downstream rendering
      const outW = 900, outH = Math.round(outW/IMG_ASPECT_RATIO);
      const outScale = scale*(outW/s.boxW);
      const drawW = s.img.width*outScale, drawH = s.img.height*outScale;
      const x = outW/2 - drawW/2 + s.panX*(outW/s.boxW);
      const y = outH/2 - drawH/2 + s.panY*(outW/s.boxW);
      const out = document.createElement('canvas');
      out.width = outW; out.height = outH;
      const octx = out.getContext('2d');
      octx.drawImage(s.img, x, y, drawW, drawH);
      slides[s.idx].imageData = out.toDataURL('image/jpeg', 0.92);
      document.getElementById('cropModal').style.display = 'none';
      cropState = null;
      renderSlideList();
    });

    document.getElementById('btnAddSlide').addEventListener('click', ()=>{
      const contentCount = slides.filter(s=>s.role==='content').length;
      if(slides.length >= 5){ return; }
      const closingIdx = slides.length-1;
      slides.splice(closingIdx, 0, {role:'content', style:'punchy', text:'', icon:'none', imageData:null, imagePosition:'below', ctaText:''});
      renderSlideList();
    });
    document.getElementById('btnRemoveSlide').addEventListener('click', ()=>{
      const contentIdxs = slides.map((s,i)=>s.role==='content'?i:-1).filter(i=>i>=0);
      if(contentIdxs.length <= 1){ return; }
      slides.splice(contentIdxs[contentIdxs.length-1], 1);
      renderSlideList();
    });

    // ---------- icon drawing (simple line-art, matches editorial style) ----------
    function drawIcon(ctx, key, cx, cy, size){
      ctx.save();
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
      ctx.lineWidth = Math.max(2, size*0.045);
      ctx.lineCap = 'round';
      const s = size/2;
      switch(key){
        case 'balance':
          ctx.beginPath(); ctx.moveTo(cx, cy-s); ctx.lineTo(cx, cy+s*0.6); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx-s*0.9, cy-s*0.3); ctx.lineTo(cx+s*0.9, cy-s*0.3); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx-s*0.9, cy, s*0.28, 0, Math.PI*2); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx+s*0.9, cy, s*0.28, 0, Math.PI*2); ctx.stroke();
          break;
        case 'growth':
          ctx.beginPath(); ctx.moveTo(cx-s, cy+s*0.7); ctx.lineTo(cx-s*0.2, cy-s*0.1); ctx.lineTo(cx+s*0.3, cy+s*0.3); ctx.lineTo(cx+s, cy-s*0.8); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx+s*0.5, cy-s*0.8); ctx.lineTo(cx+s, cy-s*0.8); ctx.lineTo(cx+s, cy-s*0.3); ctx.stroke();
          break;
        case 'coin':
          ctx.beginPath(); ctx.ellipse(cx, cy-s*0.15, s*0.75, s*0.5, 0, 0, Math.PI*2); ctx.stroke();
          ctx.beginPath(); ctx.ellipse(cx, cy+s*0.25, s*0.75, s*0.5, 0, 0, Math.PI); ctx.stroke();
          break;
        case 'clock':
          ctx.beginPath(); ctx.arc(cx, cy, s*0.85, 0, Math.PI*2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy-s*0.5); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx+s*0.35, cy+s*0.15); ctx.stroke();
          break;
        case 'chat':
          roundRectPath(ctx, cx-s*0.9, cy-s*0.7, s*1.8, s*1.15, s*0.25);
          ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx-s*0.4, cy+s*0.45); ctx.lineTo(cx-s*0.55, cy+s*0.85); ctx.lineTo(cx-s*0.05, cy+s*0.45); ctx.closePath(); ctx.stroke();
          break;
        case 'handshake':
          ctx.beginPath(); ctx.moveTo(cx-s, cy-s*0.2); ctx.lineTo(cx-s*0.15, cy+s*0.35); ctx.lineTo(cx+s*0.15, cy+s*0.05); ctx.lineTo(cx+s, cy-s*0.5); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx-s*0.15, cy+s*0.35, s*0.12, 0, Math.PI*2); ctx.stroke();
          break;
        case 'compass':
          ctx.beginPath(); ctx.arc(cx, cy, s*0.85, 0, Math.PI*2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx, cy-s*0.5); ctx.lineTo(cx+s*0.22, cy); ctx.lineTo(cx, cy+s*0.5); ctx.lineTo(cx-s*0.22, cy); ctx.closePath(); ctx.stroke();
          break;
        case 'shield':
          ctx.beginPath();
          ctx.moveTo(cx, cy-s*0.85);
          ctx.lineTo(cx+s*0.75, cy-s*0.5);
          ctx.lineTo(cx+s*0.75, cy*1+s*0.15);
          ctx.quadraticCurveTo(cx+s*0.6, cy+s*0.7, cx, cy+s*0.9);
          ctx.quadraticCurveTo(cx-s*0.6, cy+s*0.7, cx-s*0.75, cy+s*0.15);
          ctx.lineTo(cx-s*0.75, cy-s*0.5);
          ctx.closePath();
          ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx-s*0.3, cy); ctx.lineTo(cx-s*0.05, cy+s*0.28); ctx.lineTo(cx+s*0.4, cy-s*0.25); ctx.stroke();
          break;
      }
      ctx.restore();
    }

    function roundRectPath(ctx, x, y, w, h, r){
      ctx.beginPath();
      ctx.moveTo(x+r, y);
      ctx.arcTo(x+w, y, x+w, y+h, r);
      ctx.arcTo(x+w, y+h, x, y+h, r);
      ctx.arcTo(x, y+h, x, y, r);
      ctx.arcTo(x, y, x+w, y, r);
      ctx.closePath();
    }

    // ---------- text wrapping ----------
    function wrapText(ctx, text, maxWidth){
      const words = text.split(/\s+/).filter(Boolean);
      const lines = [];
      let cur = '';
      for(const w of words){
        const test = (cur + ' ' + w).trim();
        if(ctx.measureText(test).width <= maxWidth || !cur){
          cur = test;
        }else{
          lines.push(cur);
          cur = w;
        }
      }
      if(cur) lines.push(cur);
      return lines;
    }

    function loadImage(src){
      return new Promise((resolve,reject)=>{
        const img = new Image();
        img.onload = ()=>resolve(img);
        img.onerror = reject;
        img.src = src;
      });
    }

    // ---------- sticker + speech bubble (used on opening AND closing slides) ----------
    // side 'right': sticker hugs the right edge, bubble sits to its LEFT, aligned to head height.
    // side 'left':  sticker hugs the left edge (at LEFT_MARGIN), bubble sits to its RIGHT and
    //               slightly ABOVE the head, per "speech bubble on the right top of the sticker head".
    async function drawStickerBubble(ctx, bubbleTextLines, stickerImg, side, zoneY0, zoneY1){
      ctx.font = "400 12px Fraunces";
      const pad = 10;
      const longestLineW = Math.max(...bubbleTextLines.map(l=>ctx.measureText(l).width));
      const bubbleBoxW = Math.round(longestLineW + pad*2);
      const lineH = 15;
      const bubbleH = pad*2 + lineH*bubbleTextLines.length;

      let stickerW = CANVAS_W*0.08, stickerH = stickerW, aspect = 1;
      if(stickerImg){
        const scale = stickerW/stickerImg.width;
        stickerH = stickerImg.height*scale;
        aspect = stickerImg.height/stickerImg.width;
      }

      const zoneH = zoneY1 - zoneY0;
      const stickerY = zoneY0 + Math.max(0,(zoneH - stickerH)/2);
      const headFraction = aspect > 1.4 ? 0.22 : 0.38; // full-body vs headshot/bust poses
      const headCenterY = stickerY + stickerH*headFraction;

      let stickerX, bubbleX, bubbleY0, tailMode;
      if(side === 'left'){
        stickerX = LEFT_MARGIN;
        bubbleX = stickerX + stickerW + 28;
        bubbleY0 = headCenterY - bubbleH - 14; // sits above the head
        tailMode = 'bottom-left';
      } else {
        stickerX = CANVAS_W - stickerW - LEFT_MARGIN; // mirror the left margin so it stays inside the safe zone
        bubbleX = stickerX - bubbleBoxW - 28;
        bubbleY0 = headCenterY - bubbleH/2; // level with the head
        tailMode = 'right';
      }

      ctx.save();
      ctx.shadowColor = 'rgba(43,43,43,0.16)';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 5;
      roundRectPath(ctx, bubbleX, bubbleY0, bubbleBoxW, bubbleH, 14);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = 'rgba(43,43,43,0.35)'; ctx.lineWidth = 1.3;
      roundRectPath(ctx, bubbleX, bubbleY0, bubbleBoxW, bubbleH, 14);
      ctx.stroke();

      ctx.beginPath();
      if(tailMode === 'right'){
        const tailY = bubbleY0 + bubbleH/2;
        ctx.moveTo(bubbleX+bubbleBoxW-2, tailY-9);
        ctx.quadraticCurveTo(bubbleX+bubbleBoxW+18, tailY, bubbleX+bubbleBoxW+2, tailY+9);
      } else {
        // bottom-left corner, pointing down toward the sticker's head
        ctx.moveTo(bubbleX+2, bubbleY0+bubbleH-2);
        ctx.quadraticCurveTo(bubbleX-16, bubbleY0+bubbleH+16, bubbleX+9, bubbleY0+bubbleH+2);
      }
      ctx.closePath();
      ctx.fillStyle = '#FFFFFF'; ctx.fill();
      ctx.strokeStyle = 'rgba(43,43,43,0.35)'; ctx.lineWidth = 1.3; ctx.stroke();

      ctx.fillStyle = INK;
      let ty = bubbleY0 + pad + 9;
      bubbleTextLines.forEach(line=>{
        ctx.fillText(line, bubbleX+pad, ty);
        ty += lineH;
      });

      if(stickerImg){
        ctx.drawImage(stickerImg, stickerX, stickerY, stickerW, stickerH);
      }
    }

    // ---------- main slide renderer ----------
    async function drawSlide(canvas, slide, index, total, stickerSrc){
      const ctx = canvas.getContext('2d');
      canvas.width = CANVAS_W; canvas.height = CANVAS_H;
      ctx.fillStyle = BG;
      ctx.fillRect(0,0,CANVAS_W,CANVAS_H);

      // progress bar
      const trackY = 72;
      ctx.strokeStyle = 'rgba(43,43,43,0.18)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(LEFT_MARGIN, trackY); ctx.lineTo(LEFT_MARGIN+COL_WIDTH, trackY); ctx.stroke();
      ctx.strokeStyle = INK;
      const fillX = LEFT_MARGIN + COL_WIDTH * ((index+1)/total);
      ctx.beginPath(); ctx.moveTo(LEFT_MARGIN, trackY); ctx.lineTo(fillX, trackY); ctx.stroke();

      // Sticker/bubble zone shared by the opening slide (fixed phrase) and the closing
      // slide (editable CTA) — a small "signature" band pinned lower on the page.
      const OPENING_ZONE_Y0 = Math.round(CANVAS_H*0.676);
      const OPENING_ZONE_Y1 = Math.round(CANVAS_H*0.832);

      // main content block — measured first, then vertically balanced in the space available
      // (rather than pinned to the top, so short slides don't leave a dead zone at the bottom)
      const isClosing = slide.role === 'closing';
      const isParagraph = slide.style === 'paragraph';
      const isOpening = slide.role === 'opening';
      ctx.fillStyle = INK;
      ctx.textBaseline = 'alphabetic';

      if(isClosing){
        // Layout B: vertically centered, but bounded above the sticker/bubble zone below
        ctx.font = "600 50px Fraunces";
        const lh = 64;
        const lines = wrapText(ctx, slide.text || 'Your closing line goes here.', COL_WIDTH);
        const blockH = lh*lines.length;
        const topB = 190, bottomB = OPENING_ZONE_Y0 - 40;
        let ty = topB + Math.max(0,(bottomB - topB - blockH)/2) + Math.round(lh*0.7);
        lines.forEach(line=>{ ctx.fillText(line, LEFT_MARGIN, ty); ty += lh; });
      } else {
        const textFont = isParagraph ? "400 32px Inter" : "600 50px Fraunces";
        const textLH = isParagraph ? 46 : 64;

        // preload optional image — every slide's image uses the same fixed frame (IMG_ASPECT_RATIO),
        // already cropped to that ratio by the in-app cropper, so this is a straight fixed-size draw
        let img = null, imgW = 0, imgH = 0;
        if(slide.imageData){
          try{
            img = await loadImage(slide.imageData);
            imgW = CANVAS_W*0.45;
            imgH = imgW / IMG_ASPECT_RATIO;
          }catch(e){}
        }
        const hasIcon = slide.icon && slide.icon !== 'none' && !img; // image takes priority over icon
        const ICON_SIZE = 100;

        // safety net: center-crop to IMG_ASPECT_RATIO in case an image wasn't run through the cropper
        function drawCroppedImage(x, y){
          const srcRatio = img.width/img.height, dstRatio = imgW/imgH;
          let sx,sy,sw,sh;
          if(srcRatio > dstRatio){ sh = img.height; sw = sh*dstRatio; sx=(img.width-sw)/2; sy=0; }
          else { sw = img.width; sh = sw/dstRatio; sx=0; sy=(img.height-sh)/2; }
          ctx.drawImage(img, sx, sy, sw, sh, x, y, imgW, imgH);
        }

        // build the ordered list of blocks for this slide
        let blocks = [];
        const wordCount = (slide.text||'').trim().split(/\s+/).filter(Boolean).length;
        const longParagraphWithImage = img && wordCount > 25;

        if(longParagraphWithImage){
          // split into two halves (by sentence, falling back to word-count) with the image between them
          const fullText = slide.text || '';
          const sentences = fullText.match(/[^.!?]+[.!?]*\s*/g) || [fullText];
          let acc = [], accWords = 0;
          for(const s of sentences){
            acc.push(s);
            accWords += s.trim().split(/\s+/).filter(Boolean).length;
            if(accWords >= wordCount/2) break;
          }
          const usedLen = acc.join('').length;
          let part1 = acc.join('').trim();
          let part2 = fullText.slice(usedLen).trim();
          if(!part2){
            const words = fullText.trim().split(/\s+/);
            const mid = Math.ceil(words.length/2);
            part1 = words.slice(0,mid).join(' ');
            part2 = words.slice(mid).join(' ');
          }
          ctx.font = textFont; // must be set before measuring, or wrapText mis-measures line widths
          const lines1 = wrapText(ctx, part1, COL_WIDTH);
          const lines2 = wrapText(ctx, part2, COL_WIDTH);
          blocks.push({h: textLH*lines1.length, draw:(y)=>{ ctx.font=textFont; let ty=y; lines1.forEach(l=>{ctx.fillText(l,LEFT_MARGIN,ty); ty+=textLH;}); }});
          blocks.push({h: imgH, draw:(y)=>{ const x=(CANVAS_W-imgW)/2; drawCroppedImage(x,y); }});
          blocks.push({h: textLH*lines2.length, draw:(y)=>{ ctx.font=textFont; let ty=y; lines2.forEach(l=>{ctx.fillText(l,LEFT_MARGIN,ty); ty+=textLH;}); }});
        } else {
          ctx.font = textFont;
          const lines = wrapText(ctx, slide.text || '', COL_WIDTH);
          const textBlock = {h: textLH*lines.length, draw:(y)=>{ ctx.font=textFont; let ty=y; lines.forEach(l=>{ctx.fillText(l,LEFT_MARGIN,ty); ty+=textLH;}); }};
          if(img){
            const imgBlock = {h: imgH, draw:(y)=>{ const x=(CANVAS_W-imgW)/2; drawCroppedImage(x,y); }};
            blocks = slide.imagePosition === 'above' ? [imgBlock, textBlock] : [textBlock, imgBlock];
          } else if(hasIcon){
            const iconBlock = {h: ICON_SIZE, draw:(y)=>{ drawIcon(ctx, slide.icon, LEFT_MARGIN+60, y+ICON_SIZE/2, ICON_SIZE); }};
            blocks = [textBlock, iconBlock];
          } else {
            blocks = [textBlock];
          }
        }

        // space every block evenly through the available band
        const GAP_MIN = 36;
        const topBound = 190;
        const bottomBound = isOpening ? (OPENING_ZONE_Y0 - 40) : (CANVAS_H - 230);
        const available = Math.max(0, bottomBound - topBound);
        const sumH = blocks.reduce((a,b)=>a+b.h, 0);
        const gapCount = blocks.length + 1;
        const evenGap = Math.max(GAP_MIN, (available - sumH) / gapCount);

        ctx.fillStyle = INK;
        let y = topBound + evenGap;
        blocks.forEach(b=>{ b.draw(y); y += b.h + evenGap; });
      }

      // Slide 1 & last slide: sticker + speech bubble, pinned inside the fixed lower zone
      // (kept small and together, sitting below the main text rather than above it)
      if(isOpening || isClosing){
        const side = Math.random() < 0.5 ? 'left' : 'right';
        let stickerImg = null;
        if(stickerSrc){
          try{ stickerImg = await loadImage(stickerSrc); }catch(e){}
        }
        const bubbleLines = isOpening
          ? FIXED_PHRASE_LINES
          : (()=>{ ctx.font = "400 12px Fraunces"; return wrapText(ctx, (slide.ctaText||'').trim() || 'Follow for more!', 260); })();
        await drawStickerBubble(ctx, bubbleLines, stickerImg, side, OPENING_ZONE_Y0, OPENING_ZONE_Y1);
      }

      // connector arrow (all but last slide)
      if(index < total-1){
        const ax = LEFT_MARGIN + COL_WIDTH - 10, ay = CANVAS_H - 165;
        ctx.strokeStyle = INK; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(ax-40, ay); ctx.lineTo(ax, ay); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ax-14, ay-10); ctx.lineTo(ax, ay); ctx.lineTo(ax-14, ay+10); ctx.stroke();
      }

      // logo watermark
      try{
        const logoImg = await loadImage(LOGO);
        const targetW = CANVAS_W*0.2;
        const scale = targetW/logoImg.width;
        const w = targetW, h = logoImg.height*scale;
        ctx.save();
        ctx.globalAlpha = 0.14;
        ctx.drawImage(logoImg, (CANVAS_W-w)/2, CANVAS_H*0.895, w, h);
        ctx.restore();
      }catch(e){}
    }

    // ---------- optional: single-page impact infographic (separate from the carousel) ----------
    // The image itself is fully AI-generated (whiteboard-photo style) by /api/generate-infographic;
    // this just loads it onto the canvas so the existing download/export path keeps working.
    async function drawInfographic(canvas, imageDataUrl, stickerSrc){
      const ctx = canvas.getContext('2d');
      canvas.width = CANVAS_W; canvas.height = CANVAS_H;
      const img = await loadImage(imageDataUrl);
      ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);

      if(stickerSrc){
        try{
          const sticker = await loadImage(stickerSrc);
          const aspect = sticker.height/sticker.width;

          // Find a spot that's actually empty (near-background, low-saturation) so the
          // sticker never sits on top of handwritten text or diagrams. Scan a downscaled
          // copy of the composed canvas for speed.
          const scale = 10;
          const AW = Math.round(CANVAS_W/scale), AH = Math.round(CANVAS_H/scale);
          const analysis = document.createElement('canvas');
          analysis.width = AW; analysis.height = AH;
          analysis.getContext('2d').drawImage(canvas, 0, 0, AW, AH);
          const { data } = analysis.getContext('2d').getImageData(0, 0, AW, AH);

          const isBlankPixel = (i)=>{
            const r=data[i], g=data[i+1], b=data[i+2];
            return r>=200 && g>=195 && b>=185 && (Math.max(r,g,b)-Math.min(r,g,b))<40;
          };
          const blankFrac = (x, y, w, h)=>{
            let blank=0, total=0;
            for(let yy=y; yy<y+h; yy++){
              for(let xx=x; xx<x+w; xx++){
                const i = (yy*AW+xx)*4;
                total++; if(isBlankPixel(i)) blank++;
              }
            }
            return blank/total;
          };

          const margin = Math.max(1, Math.round(CANVAS_W*0.02/scale));
          let slot = null;
          for(const frac of [0.16, 0.13, 0.11, 0.09, 0.075, 0.06]){
            const w = CANVAS_W*frac, h = w*aspect;
            const aw = Math.max(3, Math.round(w/scale)), ah = Math.max(3, Math.round(h/scale));
            if(aw+2*margin>AW || ah+2*margin>AH) continue;
            const step = Math.max(1, Math.round(aw/3));
            let best = null;
            for(let ay=margin; ay<=AH-ah-margin; ay+=step){
              for(let ax=margin; ax<=AW-aw-margin; ax+=step){
                if(blankFrac(ax, ay, aw, ah) >= 0.97){
                  const distToCorner = (AW-ax)+(AH-ay); // prefer bottom-right, matches existing layout
                  if(!best || distToCorner < best.distToCorner) best = { ax, ay, distToCorner };
                }
              }
            }
            if(best){ slot = { x: best.ax*scale, y: best.ay*scale, w, h }; break; }
          }

          if(slot) ctx.drawImage(sticker, slot.x, slot.y, slot.w, slot.h);
        }catch(e){}
      }
    }

    document.getElementById('btnGenerateInfographic').addEventListener('click', async ()=>{
      const raw = document.getElementById('rawInput').value.trim();
      const statusEl = document.getElementById('infoStatus');
      const btn = document.getElementById('btnGenerateInfographic');
      if(!raw){ statusEl.textContent = "Paste a thought in step 1 first."; return; }
      statusEl.textContent = 'Generating...';
      statusEl.classList.add('active');
      btn.disabled = true;

      try{
        if(document.fonts && document.fonts.ready){
          try{
            await Promise.all([
              document.fonts.load("400 12px Fraunces"),
              document.fonts.load("600 46px Fraunces"),
              document.fonts.load("400 30px Inter"),
              document.fonts.load("600 15px Inter"),
            ]);
            await document.fonts.ready;
          }catch(e){}
        }

        const res = await fetch('/api/generate-infographic', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({rawThoughts: raw})
        });
        if(!res.ok) throw new Error('request failed');
        const data = await res.json();
        if(!data || !data.image) throw new Error('bad shape');

        const canvas = document.createElement('canvas');
        const stickerSrc = STICKERS[Math.floor(Math.random()*STICKERS.length)];
        await drawInfographic(canvas, data.image, stickerSrc);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

        const img = document.getElementById('infoPreviewImg');
        img.src = dataUrl;
        img.style.display = 'block';
        const dlBtn = document.getElementById('btnDownloadInfo');
        dlBtn.style.display = 'inline-block';
        dlBtn.onclick = ()=>downloadDataUrl(dataUrl, 'shaneboss-infographic.jpg');
        statusEl.textContent = 'Infographic ready.';
      }catch(e){
        statusEl.textContent = "Couldn't generate infographic — try again.";
      }
      statusEl.classList.remove('active');
      btn.disabled = false;
    });

    // ---------- step 3: render + preview ----------
    document.getElementById('btnRender').addEventListener('click', async ()=>{
      const statusEl = document.getElementById('renderStatus');
      statusEl.textContent = 'Rendering...';
      document.getElementById('btnRender').disabled = true;

      if(document.fonts && document.fonts.ready){
        try{
          await Promise.all([
            document.fonts.load("400 12px Fraunces"),
            document.fonts.load("600 50px Fraunces"),
            document.fonts.load("400 32px Inter"),
          ]);
          await document.fonts.ready;
        }catch(e){}
      }

      chosenStickerIdx = Math.floor(Math.random()*STICKERS.length);
      const openingStickerSrc = STICKERS[chosenStickerIdx];
      const closingStickerSrc = STICKERS[Math.floor(Math.random()*STICKERS.length)];

      renderedSlides = [];
      for(let i=0;i<slides.length;i++){
        const canvas = document.createElement('canvas');
        const stickerForThisSlide = slides[i].role === 'closing' ? closingStickerSrc : openingStickerSrc;
        await drawSlide(canvas, slides[i], i, slides.length, stickerForThisSlide);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        renderedSlides.push(dataUrl);
      }

      statusEl.textContent = `${renderedSlides.length} slides ready.`;
      document.getElementById('btnRender').disabled = false;
      document.getElementById('previewStep').style.display = 'grid';
      currentPreviewIndex = 0;
      renderGridPreview();
      showPreview(0);
      document.getElementById('previewStep').scrollIntoView({behavior:'smooth', block:'start'});
    });

    function renderGridPreview(){
      const grid = document.getElementById('gridPreview');
      grid.innerHTML = '';
      renderedSlides.forEach((url, i)=>{
        const div = document.createElement('div');
        div.className = 'thumb' + (i===currentPreviewIndex ? ' active' : '');
        div.innerHTML = `<img src="${url}">`;
        div.addEventListener('click', ()=>showPreview(i));
        grid.appendChild(div);
      });
    }

    function showPreview(i){
      currentPreviewIndex = i;
      document.getElementById('mainPreviewImg').src = renderedSlides[i];
      document.getElementById('posLabel').textContent = `${i+1} / ${renderedSlides.length}`;
      document.querySelectorAll('.grid-preview .thumb').forEach((el,idx)=>{
        el.classList.toggle('active', idx===i);
      });
    }

    document.getElementById('btnPrev').addEventListener('click', ()=>{
      showPreview((currentPreviewIndex - 1 + renderedSlides.length) % renderedSlides.length);
    });
    document.getElementById('btnNext').addEventListener('click', ()=>{
      showPreview((currentPreviewIndex + 1) % renderedSlides.length);
    });

    function downloadDataUrl(dataUrl, filename){
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    document.getElementById('btnDownloadOne').addEventListener('click', ()=>{
      downloadDataUrl(renderedSlides[currentPreviewIndex], `shaneboss-slide-${currentPreviewIndex+1}.jpg`);
    });

    document.getElementById('btnDownloadAll').addEventListener('click', ()=>{
      renderedSlides.forEach((url, i)=>{
        setTimeout(()=>downloadDataUrl(url, `shaneboss-slide-${i+1}.jpg`), i*350);
      });
    });
  }, []);

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{__html: `
        /* Chrome only — the carousel canvas render below keeps its own Fraunces/Inter
           editorial look, that's exported artwork, not app UI. This is Bento Slate. */
        .carousel-tool{
          --line: var(--border);
          --line-strong: var(--border);
          --ink-soft: var(--dim);
        }
        .carousel-tool *{ box-sizing: border-box; }
        .carousel-tool{
          color: var(--text);
          font-family: var(--font-plex-sans), ui-sans-serif, sans-serif;
          line-height: 1.5;
          max-width: 980px; margin: 0 auto;
        }

        .carousel-tool header.app-head{ margin-bottom: 32px; }
        .carousel-tool header.app-head .eyebrow{
          font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
          color: var(--cyan); margin-bottom: 6px;
        }
        .carousel-tool header.app-head h1{
          font-weight: 600; font-size: clamp(24px, 3.4vw, 32px);
          margin: 0 0 8px; letter-spacing: -0.01em; color: var(--text);
        }
        .carousel-tool header.app-head p{ margin:0; color: var(--muted); font-size: 13px; max-width: 560px; }

        .carousel-tool .step{
          display:grid; grid-template-columns: 32px 1fr; gap: 18px;
          padding: 24px; margin-bottom: 16px;
          background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
        }
        .carousel-tool .step-num{ font-size: 18px; color: var(--dim); line-height: 1; font-weight: 600; }
        .carousel-tool .step-body h2{ font-weight: 600; font-size: 15px; margin: 0 0 4px; color: var(--text); }
        .carousel-tool .step-body > p.hint{ margin: 0 0 16px; color: var(--muted); font-size: 12.5px; }

        .carousel-tool textarea{
          width:100%; font-family: inherit; font-size:13px; color: var(--text);
          background: var(--grid); border: 1px solid var(--border);
          border-radius: 8px; padding: 12px 14px; resize: vertical;
          min-height: 110px;
        }
        .carousel-tool textarea:focus{ outline: none; border-color: var(--cyan); }

        .carousel-tool button{
          font-family: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
          border-radius: 8px; padding: 9px 18px; border: 1px solid var(--cyan);
          background: var(--cyan); color: var(--bg); transition: opacity .15s;
        }
        .carousel-tool button:hover{ opacity: 0.85; }
        .carousel-tool button.secondary{ background: transparent; color: var(--text); border-color: var(--border); }
        .carousel-tool button.ghost{ background: transparent; color: var(--muted); border-color: var(--border); }
        .carousel-tool button:disabled{ opacity: 0.4; cursor: not-allowed; }
        .carousel-tool button.small{ padding: 6px 11px; font-size: 12px; }

        .carousel-tool .row{ display:flex; gap: 10px; align-items:center; flex-wrap: wrap; }
        .carousel-tool .status{ font-size: 12px; color: var(--muted); }
        .carousel-tool .status.active{ color: var(--cyan); }

        .carousel-tool .slide-card{
          background: var(--grid); border: 1px solid var(--border);
          border-radius: 8px; padding: 14px; margin-bottom: 12px;
        }
        .carousel-tool .slide-card .top-row{
          display:flex; justify-content: space-between; align-items:center; margin-bottom: 10px;
        }
        .carousel-tool .slide-tag{
          font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.06em;
          color: var(--dim); background: var(--panel); border:1px solid var(--border);
          padding: 3px 9px; border-radius: 20px;
        }
        .carousel-tool .slide-card textarea{ min-height: 70px; font-size: 13px; }
        .carousel-tool .slide-controls{
          display:flex; gap: 16px; align-items:center; margin-top: 10px; flex-wrap: wrap;
        }
        .carousel-tool .ctrl-group{ display:flex; align-items:center; gap: 6px; font-size: 12px; color: var(--muted); }
        .carousel-tool select{
          font-family: inherit; font-size: 12px; padding: 5px 8px; border-radius: 6px;
          border: 1px solid var(--border); background: var(--grid); color: var(--text);
        }
        .carousel-tool .icon-preview{ width:20px; height:20px; }
        .carousel-tool input[type=file]{ font-size: 12px; max-width: 160px; color: var(--muted); }
        .carousel-tool .img-thumb{ display:flex; align-items:center; gap:8px; }
        .carousel-tool .img-thumb img{ width: 40px; height: 40px; object-fit: cover; border-radius: 4px; border:1px solid var(--border); }

        .carousel-tool .content-slide-list .add-remove{ display:flex; gap:8px; margin: 6px 0 18px; }

        .carousel-tool .preview-area{ margin-top: 10px; }
        .carousel-tool .grid-preview{
          display:grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 10px; margin-bottom: 24px;
        }
        .carousel-tool .grid-preview .thumb{
          cursor:pointer; border-radius: 6px; overflow:hidden; border: 1px solid var(--border);
          position: relative; aspect-ratio: 4/5; background: var(--grid);
        }
        .carousel-tool .grid-preview .thumb img{ width:100%; height:100%; object-fit:cover; display:block; }
        .carousel-tool .grid-preview .thumb.active{ outline: 2px solid var(--cyan); }

        .carousel-tool .single-viewer{ display:flex; flex-direction:column; align-items:center; gap: 14px; }
        .carousel-tool .single-viewer .canvas-holder{
          max-width: 380px; width:100%; border-radius: 10px; overflow:hidden;
          box-shadow: 0 1px 2px rgba(0,0,0,0.35); border: 1px solid var(--border);
        }
        .carousel-tool .single-viewer .canvas-holder img{ width:100%; display:block; }
        .carousel-tool .nav-row{ display:flex; align-items:center; gap: 16px; }
        .carousel-tool .nav-row .pos{ font-size: 12px; color: var(--muted); min-width: 50px; text-align:center; }

        .carousel-tool footer.foot{ margin-top: 48px; color: var(--dim); font-size: 11.5px; text-align:center; }
      `}} />

      <div className="carousel-tool wrap">

        <header className="app-head">
          <div className="eyebrow">SHANE boss — internal tool</div>
          <h1>Carousel Generator</h1>
          <p>Paste a raw thought, get it sliced into your carousel voice, then export ready-to-post JPGs.</p>
        </header>

        <div className="step">
          <div className="step-num">1</div>
          <div className="step-body">
            <h2>Your raw thought</h2>
            <p className="hint">Write it however it comes out — full sentences, fragments, voice-note style. The breakdown happens next.</p>
            <textarea id="rawInput" placeholder="e.g. thoughts on why most people never start investing even though they know they should..."></textarea>
            <div className="row" style={{marginTop:'12px'}}>
              <button id="btnGenerate">Suggest slide breakdown</button>
              <button id="btnManual" className="secondary">Skip — I&apos;ll write slides myself</button>
              <span id="genStatus" className="status"></span>
            </div>
          </div>
        </div>

        <div className="step" id="editStep" style={{display:'none'}}>
          <div className="step-num">2</div>
          <div className="step-body">
            <h2>Edit your slides</h2>
            <p className="hint">Slide 1 always opens with your signature line + sticker. Last slide is always the closing quote. Everything in between is yours to adjust.</p>
            <div id="slideList"></div>
            <div className="add-remove">
              <button className="small ghost" id="btnAddSlide">+ Add content slide</button>
              <button className="small ghost" id="btnRemoveSlide">− Remove last content slide</button>
            </div>
            <div className="row">
              <button id="btnRender">Render carousel</button>
              <span id="renderStatus" className="status"></span>
            </div>
          </div>
        </div>

        <div className="step" id="previewStep" style={{display:'none'}}>
          <div className="step-num">3</div>
          <div className="step-body">
            <h2>Preview &amp; export</h2>
            <p className="hint">Tap a slide to view it large. Download individually or all at once.</p>
            <div className="preview-area">
              <div className="grid-preview" id="gridPreview"></div>
              <div className="single-viewer">
                <div className="canvas-holder"><img id="mainPreviewImg" alt="slide preview" /></div>
                <div className="nav-row">
                  <button className="small secondary" id="btnPrev">← Prev</button>
                  <span className="pos" id="posLabel">1 / 5</span>
                  <button className="small secondary" id="btnNext">Next →</button>
                </div>
                <div className="row">
                  <button id="btnDownloadOne">Download this slide (JPG)</button>
                  <button className="secondary" id="btnDownloadAll">Download all slides</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="step" id="infoStep">
          <div className="step-num">4</div>
          <div className="step-body">
            <h2>Impact infographic (optional)</h2>
            <p className="hint">Separate from the carousel above. Uses your raw thought from step 1 to generate a single branded graphic explaining the situation and how it affects your audience.</p>
            <div className="row">
              <button id="btnGenerateInfographic">Generate impact infographic</button>
              <span id="infoStatus" className="status"></span>
            </div>
            <div className="single-viewer" style={{marginTop:'16px'}}>
              <div className="canvas-holder"><img id="infoPreviewImg" alt="infographic preview" style={{display:'none'}} /></div>
              <button id="btnDownloadInfo" className="secondary" style={{display:'none'}}>Download infographic (JPG)</button>
            </div>
          </div>
        </div>

        <footer className="foot">Built for SHANE boss · every carousel generated fresh</footer>
      </div>

      <div id="cropModal" className="carousel-tool" style={{display:'none', position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, alignItems:'center', justifyContent:'center'}}>
        <div style={{background:'var(--panel)', border:'1px solid var(--border)', borderRadius:'12px', padding:'20px', maxWidth:'420px', width:'92%'}}>
          <h3 style={{fontSize:'15px', fontWeight:600, margin:'0 0 4px', color:'var(--text)'}}>Crop image</h3>
          <p style={{fontSize:'12.5px', color:'var(--muted)', margin:'0 0 14px'}}>Drag to reposition, use the slider to zoom. Every slide image uses this same frame size.</p>
          <div id="cropStage" style={{position:'relative', width:'100%', overflow:'hidden', borderRadius:'8px', border:'1px solid var(--border)', touchAction:'none', cursor:'grab'}}>
            <canvas id="cropCanvas"></canvas>
          </div>
          <input type="range" id="cropZoom" min="100" max="300" defaultValue="100" style={{width:'100%', margin:'14px 0'}} />
          <div className="row" style={{justifyContent:'flex-end'}}>
            <button className="ghost" id="cropCancel">Cancel</button>
            <button id="cropConfirm">Use this crop</button>
          </div>
        </div>
      </div>
    </>
  );
}
