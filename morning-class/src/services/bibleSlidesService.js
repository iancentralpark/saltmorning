'use strict';

/**
 * Children's Bible story slides (Class Tools).
 * Claude writes the title + scripture + ~10 picture-book captions and image
 * prompts; Gemini image models paint each full-bleed illustration.
 *
 * Jobs are kept in memory and mirrored to disk so PDF/PPTX/Google export still
 * work after a process recycle or a long wait.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { askGemini, isClaudeConfigured, formatGeminiClientError } = require('./geminiService');
const { generateImage, isImageGenConfigured } = require('./imageGenService');

const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_JOBS = 40;
const IMAGE_PARALLEL = 3;
const TMP_ROOT = path.join(os.tmpdir(), 'salt-bible-slides');
const JOBS_DIR = path.join(TMP_ROOT, 'jobs');
const jobs = new Map();
const persistTimers = new Map();

function ensureJobsDir() {
  if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function jobDir(id) {
  return path.join(JOBS_DIR, String(id));
}

function jobMetaPath(id) {
  return path.join(jobDir(id), 'meta.json');
}

function slideImagePath(id, index, mimeType) {
  const ext = /jpeg|jpg/i.test(mimeType || '') ? '.jpg'
    : /webp/i.test(mimeType || '') ? '.webp'
      : /svg/i.test(mimeType || '') ? '.svg'
        : '.png';
  return path.join(jobDir(id), 'slide-' + String(index).padStart(2, '0') + ext);
}

function writeSlideImage(id, index, img) {
  if (!img || !img.data) return;
  ensureJobsDir();
  const dir = jobDir(id);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Remove previous extension variants for this slide index.
  try {
    fs.readdirSync(dir).forEach((f) => {
      if (new RegExp('^slide-' + String(index).padStart(2, '0') + '\\.').test(f)) {
        fs.unlinkSync(path.join(dir, f));
      }
    });
  } catch (_) { /* ignore */ }
  fs.writeFileSync(slideImagePath(id, index, img.mimeType), Buffer.from(img.data, 'base64'));
}

function readSlideImage(id, index) {
  const dir = jobDir(id);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) =>
    new RegExp('^slide-' + String(index).padStart(2, '0') + '\\.').test(f)
  );
  if (!files.length) return null;
  const file = files[0];
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
      : ext === '.svg' ? 'image/svg+xml'
        : 'image/png';
  return {
    mimeType: mime,
    data: fs.readFileSync(path.join(dir, file)).toString('base64'),
    placeholder: false
  };
}

function serializeJob(job) {
  return {
    id: job.id,
    ownerKey: job.ownerKey,
    status: job.status,
    phase: job.phase,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    input: job.input,
    progress: job.progress,
    script: job.script,
    warnings: job.warnings || [],
    error: job.error || null,
    imageMeta: (job.images || []).map((img, i) => (img ? {
      index: i + 1,
      mimeType: img.mimeType,
      placeholder: !!img.placeholder,
      model: img.model || null
    } : null))
  };
}

function persistJobNow(job) {
  if (!job || !job.id) return;
  try {
    ensureJobsDir();
    const dir = jobDir(job.id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    (job.images || []).forEach((img, i) => {
      if (img && img.data) writeSlideImage(job.id, i + 1, img);
    });
    fs.writeFileSync(jobMetaPath(job.id), JSON.stringify(serializeJob(job)));
  } catch (e) {
    console.warn('bibleSlides disk persist failed', job.id, e.message);
  }
}

function schedulePersist(job, immediate) {
  if (!job || !job.id) return;
  if (immediate) {
    if (persistTimers.has(job.id)) {
      clearTimeout(persistTimers.get(job.id));
      persistTimers.delete(job.id);
    }
    persistJobNow(job);
    return;
  }
  if (persistTimers.has(job.id)) return;
  persistTimers.set(job.id, setTimeout(() => {
    persistTimers.delete(job.id);
    persistJobNow(job);
  }, 800));
}

function loadJobFromDisk(jobId) {
  const metaFile = jobMetaPath(jobId);
  if (!fs.existsSync(metaFile)) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const images = [];
    const n = (meta.script && meta.script.slides && meta.script.slides.length) || 0;
    for (let i = 1; i <= n; i++) {
      const img = readSlideImage(jobId, i);
      if (img && meta.imageMeta && meta.imageMeta[i - 1] && meta.imageMeta[i - 1].placeholder) {
        img.placeholder = true;
      }
      images.push(img);
    }
    const job = {
      id: meta.id,
      ownerKey: meta.ownerKey,
      status: meta.status,
      phase: meta.phase,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      input: meta.input,
      progress: meta.progress,
      script: meta.script,
      images,
      warnings: meta.warnings || [],
      error: meta.error || null,
      fromDisk: true
    };
    jobs.set(job.id, job);
    return job;
  } catch (e) {
    console.warn('bibleSlides disk load failed', jobId, e.message);
    return null;
  }
}

function deleteJobDisk(jobId) {
  const dir = jobDir(jobId);
  if (!fs.existsSync(dir)) return;
  try {
    fs.readdirSync(dir).forEach((f) => fs.unlinkSync(path.join(dir, f)));
    fs.rmdirSync(dir);
  } catch (_) { /* ignore */ }
}

const STYLE_PRESETS = {
  storybook: {
    label: '수채화 동화책',
    prompt: 'soft watercolor children\'s picture-book illustration, warm pastel palette, gentle rounded shapes, friendly expressive faces, clean composition, no text, no letters, no watermark'
  },
  cartoon: {
    label: '밝은 카툰',
    prompt: 'bright flat vector cartoon illustration for kids, bold clean outlines, cheerful saturated colors, big friendly eyes, simple shapes, no text, no letters, no watermark'
  },
  clay: {
    label: '클레이 3D',
    prompt: 'cute claymation style 3D render, soft studio lighting, rounded plasticine characters, playful and warm, no text, no letters, no watermark'
  },
  paper: {
    label: '종이 오리기',
    prompt: 'layered paper-cut craft illustration, soft shadows, cheerful colors, simple friendly characters, no text, no letters, no watermark'
  }
};

const AUDIENCE_PRESETS = {
  preschool: { label: '유치부 (5–7세)', note: '아주 쉬운 단어, 한 문장 10자 내외, 반복과 의성어 활용' },
  lower: { label: '초등 저학년 (1–3학년)', note: '쉬운 단어, 짧은 문장, 감정과 행동 위주' },
  upper: { label: '초등 고학년 (4–6학년)', note: '조금 더 구체적인 사건과 의미, 생각할 질문 포함 가능' }
};

const LANGUAGE_PRESETS = {
  ko: { label: '한국어', note: '모든 자막은 한국어' },
  en: { label: 'English', note: 'All captions in simple English for children' },
  bi: { label: '한국어 + English', note: '각 자막은 한국어 1~2줄 뒤에 짧은 영어 한 줄을 덧붙임' }
};

function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { /* continue */ }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch (e2) { /* continue */ }
  }
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try { return JSON.parse(raw.slice(s, e + 1)); } catch (e3) { /* continue */ }
  }
  return null;
}

function clampSlides(n) {
  const x = Math.round(Number(n) || 10);
  return Math.max(6, Math.min(14, x));
}

function pick(map, key, fallback) {
  const k = String(key || '').trim();
  return map[k] ? k : fallback;
}

function claudeModel() {
  return String(
    process.env.TEACHER_CLAUDE_MODEL
    || process.env.CLAUDE_MODEL
    || process.env.ANTHROPIC_MODEL
    || 'claude-sonnet-4-5'
  ).trim() || 'claude-sonnet-4-5';
}

const SYSTEM_PROMPT = `당신은 어린이 주일학교(교회학교) 설교와 그림책을 만드는 전문가입니다.
사용자가 성경 구절이나 성경 이야기를 제시하면, 어린이용 설교 슬라이드 대본을 JSON으로 작성합니다.

[필수 규칙]
- 첫 슬라이드(kind="title")는 말씀 제목과 성경 구절(책 장:절 + 핵심 구절 본문 1~2문장)을 담는다.
- 이후 슬라이드(kind="story")는 이야기를 순서대로 진행한다. 한 슬라이드 = 한 장면.
- 마지막 슬라이드(kind="closing")는 오늘의 말씀 한 줄 적용(아이들에게 주는 메시지)과 짧은 기도문 한 문장.
- caption은 그림 아래 들어갈 자막: 1줄 이상 최대 3줄, 전체 90자 이내. 줄바꿈은 "\\n"으로.
- imagePrompt는 영어로, 그 장면을 그림으로 그릴 수 있게 구체적으로 (인물, 행동, 배경, 분위기, 시대 의상). 
  인물 외모/의상을 모든 슬라이드에서 일관되게 유지할 것. 글자·문구·성경구절 텍스트를 그림에 넣지 말 것.
  폭력·공포·피 묘사는 어린이에게 맞게 순화할 것 (예: 골리앗이 쓰러짐 → 큰 사람이 놀라 넘어지는 장면, 피 없음).
- 신학적으로 정확하고 성경 본문에 충실할 것. 성경에 없는 사실을 지어내지 말 것.
- 출력은 JSON만. 마크다운 코드펜스 금지.`;

function buildScriptPrompt({ topic, slideCount, audienceKey, languageKey, styleKey }) {
  const storyCount = slideCount - 2;
  return [
    '다음 요청으로 어린이 설교 슬라이드 대본을 만들어라.',
    '요청(성경 구절 또는 이야기): ' + topic,
    '대상: ' + AUDIENCE_PRESETS[audienceKey].label + ' — ' + AUDIENCE_PRESETS[audienceKey].note,
    '자막 언어: ' + LANGUAGE_PRESETS[languageKey].label + ' — ' + LANGUAGE_PRESETS[languageKey].note,
    '그림 스타일 참고: ' + STYLE_PRESETS[styleKey].label,
    '',
    '총 슬라이드 수: ' + slideCount + ' (title 1 + story ' + storyCount + ' + closing 1).',
    '',
    'JSON 스키마:',
    JSON.stringify({
      title: '말씀 제목 (짧고 어린이 친화적)',
      scriptureRef: '예: 사무엘상 17:45',
      scriptureText: '핵심 구절 본문 1~2문장 (개역개정 또는 쉬운성경 기준으로 정확하게)',
      summary: '이야기 한 줄 요약',
      characterSheet: 'Main characters appearance/costume in English for consistent illustration (e.g., David: small shepherd boy, curly brown hair, beige tunic, leather sling)',
      slides: [
        {
          kind: 'title|story|closing',
          caption: '자막 1~3줄, \\n 줄바꿈, 90자 이내',
          imagePrompt: 'English scene description for the illustrator, no text in image',
          teacherNote: '교사용 짧은 설명/발문 한 문장 (선택)'
        }
      ]
    }, null, 2),
    '',
    'slides 길이는 정확히 ' + slideCount + '개. 첫 번째 kind=title, 마지막 kind=closing, 나머지 kind=story.',
    'title 슬라이드의 caption은 "제목\\n성경구절 참조" 형태로 2줄.',
    'closing 슬라이드의 caption은 "오늘의 말씀 적용 한 줄\\n짧은 기도 한 문장" 2줄.'
  ].join('\n');
}

async function askClaudeJson(prompt, opts) {
  opts = opts || {};
  if (!isClaudeConfigured()) {
    const err = new Error('Claude is not configured (set ANTHROPIC_API_KEY).');
    err.statusCode = 503;
    throw err;
  }
  try {
    const result = await askGemini(prompt, {
      provider: 'claude',
      noGeminiFallback: true,
      systemInstruction: SYSTEM_PROMPT,
      temperature: opts.temperature != null ? opts.temperature : 0.6,
      maxOutputTokens: opts.maxOutputTokens || 6000,
      responseMimeType: 'application/json',
      model: claudeModel()
    });
    const text = (result && (result.answer || result.text)) || result;
    const parsed = extractJson(text);
    if (!parsed) {
      const err = new Error('AI returned invalid JSON.');
      err.statusCode = 502;
      throw err;
    }
    return parsed;
  } catch (e) {
    if (e.statusCode) throw e;
    const err = new Error(formatGeminiClientError(e));
    err.statusCode = 502;
    throw err;
  }
}

function normalizeCaption(raw) {
  let s = String(raw || '').replace(/\r/g, '').trim();
  s = s.replace(/\\n/g, '\n');
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 3);
  return lines.join('\n');
}

function coerceScript(parsed, { slideCount, topic }) {
  const slidesRaw = Array.isArray(parsed && parsed.slides) ? parsed.slides : [];
  const slides = slidesRaw.map((s, i) => {
    let kind = String((s && s.kind) || '').toLowerCase();
    if (i === 0) kind = 'title';
    else if (i === slidesRaw.length - 1) kind = 'closing';
    else if (kind !== 'story') kind = 'story';
    return {
      index: i + 1,
      kind,
      caption: normalizeCaption(s && s.caption),
      imagePrompt: String((s && s.imagePrompt) || '').trim(),
      teacherNote: String((s && s.teacherNote) || '').trim()
    };
  }).filter((s) => s.caption || s.imagePrompt);

  if (slides.length < 4) {
    const err = new Error('대본 생성 결과가 너무 짧습니다. 주제를 조금 더 구체적으로 적어 다시 시도해 주세요.');
    err.statusCode = 502;
    throw err;
  }
  // Trim/pad to requested count softly (never pad with empty slides).
  const trimmed = slides.length > slideCount
    ? slides.slice(0, slideCount - 1).concat([slides[slides.length - 1]])
    : slides;
  trimmed.forEach((s, i) => {
    s.index = i + 1;
    if (i === 0) s.kind = 'title';
    else if (i === trimmed.length - 1) s.kind = 'closing';
    else s.kind = 'story';
  });

  const title = String((parsed && parsed.title) || '').trim() || topic;
  const scriptureRef = String((parsed && parsed.scriptureRef) || '').trim();
  const scriptureText = String((parsed && parsed.scriptureText) || '').trim();
  if (!trimmed[0].caption) {
    trimmed[0].caption = [title, scriptureRef].filter(Boolean).join('\n');
  }
  return {
    title,
    scriptureRef,
    scriptureText,
    summary: String((parsed && parsed.summary) || '').trim(),
    characterSheet: String((parsed && parsed.characterSheet) || '').trim(),
    slides: trimmed
  };
}

function buildImagePrompt(script, slide, styleKey) {
  const style = STYLE_PRESETS[styleKey].prompt;
  const parts = [
    'Children\'s Bible story illustration for a Sunday school slide.',
    'Scene: ' + (slide.imagePrompt || slide.caption.replace(/\n/g, ' ')),
    script.characterSheet ? 'Characters (keep consistent): ' + script.characterSheet : '',
    'Style: ' + style + '.',
    'Wide 16:9 composition that fills the whole frame edge to edge, main subject slightly above center,',
    'leave the bottom fifth of the image calm and uncluttered (a caption bar will overlay it).',
    'Absolutely no text, letters, numbers, captions, speech bubbles, or watermarks in the image.',
    'Family-friendly, gentle, hopeful mood, suitable for ages 5-12.'
  ];
  if (slide.kind === 'title') {
    parts.push('This is the cover scene: iconic, inviting establishing shot of the story setting and main character.');
  }
  if (slide.kind === 'closing') {
    parts.push('This is the closing scene: warm, peaceful, uplifting (e.g. children praying, sunrise, embrace).');
  }
  return parts.filter(Boolean).join(' ');
}

function placeholderSvg(slide, idx) {
  const palettes = [
    ['#f7d6a0', '#f2a65a'], ['#cfe8ff', '#7fb3ff'], ['#d9f2d0', '#7fc77a'],
    ['#ffd6e0', '#ff8fab'], ['#e9ddff', '#b68cff'], ['#fff2b3', '#ffd34d']
  ];
  const [a, b] = palettes[idx % palettes.length];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">'
    + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs>'
    + '<rect width="1600" height="900" fill="url(#g)"/>'
    + '<circle cx="1300" cy="200" r="120" fill="rgba(255,255,255,0.55)"/>'
    + '<circle cx="300" cy="700" r="180" fill="rgba(255,255,255,0.35)"/>'
    + '<text x="800" y="430" font-size="150" text-anchor="middle" font-family="Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif">📖</text>'
    + '<text x="800" y="560" font-size="40" text-anchor="middle" fill="rgba(40,40,60,0.75)" font-family="Noto Sans KR, sans-serif">그림을 불러오지 못했습니다 — 이미지 다시 생성을 눌러 주세요</text>'
    + '</svg>';
  return { mimeType: 'image/svg+xml', data: Buffer.from(svg, 'utf8').toString('base64'), placeholder: true };
}

async function paintSlide(script, slide, styleKey) {
  const prompt = buildImagePrompt(script, slide, styleKey);
  const img = await generateImage(prompt, { aspectRatio: '16:9', timeoutMs: 100000 });
  return { mimeType: img.mimeType, data: img.data, model: img.model, prompt };
}

async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  const lanes = [];
  for (let k = 0; k < Math.min(limit, items.length); k++) lanes.push(lane());
  await Promise.all(lanes);
  return results;
}

function pruneJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - (job.updatedAt || job.createdAt) > JOB_TTL_MS) {
      jobs.delete(id);
      deleteJobDisk(id);
    }
  }
  if (jobs.size > MAX_JOBS) {
    const sorted = Array.from(jobs.values()).sort((a, b) => a.updatedAt - b.updatedAt);
    while (jobs.size > MAX_JOBS && sorted.length) {
      const old = sorted.shift();
      jobs.delete(old.id);
      if (old.status !== 'done') deleteJobDisk(old.id);
    }
  }
  // Also prune orphaned disk jobs older than TTL.
  try {
    ensureJobsDir();
    fs.readdirSync(JOBS_DIR).forEach((id) => {
      const meta = jobMetaPath(id);
      if (!fs.existsSync(meta)) return;
      try {
        const st = fs.statSync(meta);
        if (now - st.mtimeMs > JOB_TTL_MS) deleteJobDisk(id);
      } catch (_) { /* ignore */ }
    });
  } catch (_) { /* ignore */ }
}

function touch(job, patch) {
  Object.assign(job, patch || {});
  job.updatedAt = Date.now();
  const immediate = job.status === 'done' || job.status === 'error' || (patch && patch.script);
  schedulePersist(job, immediate);
}

function startJob(opts, ownerKey) {
  pruneJobs();
  const topic = String((opts && opts.topic) || '').trim();
  if (topic.length < 2) {
    const err = new Error('성경 구절이나 이야기를 입력해 주세요. (예: 다윗과 골리앗, 요한복음 3:16)');
    err.statusCode = 400;
    throw err;
  }
  if (!isClaudeConfigured()) {
    const err = new Error('Claude is not configured (set ANTHROPIC_API_KEY).');
    err.statusCode = 503;
    throw err;
  }
  const slideCount = clampSlides(opts.slideCount);
  const audienceKey = pick(AUDIENCE_PRESETS, opts.audience, 'lower');
  const languageKey = pick(LANGUAGE_PRESETS, opts.language, 'ko');
  const styleKey = pick(STYLE_PRESETS, opts.style, 'storybook');

  const id = newId('bs');
  const job = {
    id,
    ownerKey: String(ownerKey || ''),
    status: 'running',
    phase: 'script',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    input: { topic, slideCount, audienceKey, languageKey, styleKey },
    progress: { done: 0, total: slideCount, message: 'Claude가 대본을 쓰는 중…' },
    script: null,
    images: [],
    warnings: [],
    error: null
  };
  jobs.set(id, job);

  schedulePersist(job, true);
  setImmediate(() => runJob(job).catch((e) => {
    touch(job, { status: 'error', error: e.message || '생성 실패', phase: 'error' });
    console.error('bibleSlides job', id, e);
  }));

  return publicJob(job);
}

async function runJob(job) {
  const { topic, slideCount, audienceKey, languageKey, styleKey } = job.input;
  const parsed = await askClaudeJson(buildScriptPrompt({ topic, slideCount, audienceKey, languageKey, styleKey }));
  const script = coerceScript(parsed, { slideCount, topic });
  touch(job, {
    script,
    phase: 'images',
    progress: { done: 0, total: script.slides.length, message: '그림 그리는 중… 0/' + script.slides.length }
  });

  const imageOk = isImageGenConfigured();
  if (!imageOk) {
    job.warnings.push({ code: 'images_unavailable', message: 'GEMINI_API_KEY가 없어 그림 대신 배경만 표시됩니다.' });
  }

  const images = new Array(script.slides.length);
  let done = 0;
  await runPool(script.slides, IMAGE_PARALLEL, async (slide, i) => {
    if (!imageOk) {
      images[i] = placeholderSvg(slide, i);
    } else {
      try {
        images[i] = await paintSlide(script, slide, styleKey);
      } catch (e) {
        job.warnings.push({ code: 'image_failed', slide: i + 1, message: e.message });
        images[i] = placeholderSvg(slide, i);
      }
    }
    done += 1;
    touch(job, {
      images: images.slice(),
      progress: { done, total: script.slides.length, message: '그림 그리는 중… ' + done + '/' + script.slides.length }
    });
  });

  touch(job, {
    images,
    status: 'done',
    phase: 'done',
    progress: { done: script.slides.length, total: script.slides.length, message: '완료' }
  });
}

function getJob(jobId, ownerKey) {
  pruneJobs();
  const id = String(jobId || '');
  let job = jobs.get(id);
  if (!job) job = loadJobFromDisk(id);
  if (!job) return null;
  if (ownerKey && job.ownerKey && job.ownerKey !== String(ownerKey)) {
    const err = new Error('이 슬라이드 작업에 접근할 수 없습니다.');
    err.statusCode = 404;
    throw err;
  }
  return job;
}

function jobNotFoundError() {
  const err = new Error(
    '슬라이드 작업을 찾을 수 없습니다. 서버가 재시작됐거나 오래되어 만료됐을 수 있어요. 「슬라이드 만들기」로 다시 생성해 주세요.'
  );
  err.statusCode = 404;
  return err;
}

function dataUri(img) {
  if (!img || !img.data) return '';
  return 'data:' + (img.mimeType || 'image/png') + ';base64,' + img.data;
}

function publicJob(job, opts) {
  opts = opts || {};
  const out = {
    jobId: job.id,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    input: job.input,
    warnings: job.warnings,
    error: job.error || undefined
  };
  if (job.script) {
    out.script = {
      title: job.script.title,
      scriptureRef: job.script.scriptureRef,
      scriptureText: job.script.scriptureText,
      summary: job.script.summary,
      slides: job.script.slides.map((s, i) => ({
        index: s.index,
        kind: s.kind,
        caption: s.caption,
        teacherNote: s.teacherNote,
        hasImage: !!(job.images[i] && job.images[i].data),
        placeholder: !!(job.images[i] && job.images[i].placeholder),
        imageUrl: opts.includeImages && job.images[i] ? dataUri(job.images[i]) : undefined
      }))
    };
  }
  if (job.status === 'done') {
    out.deckUrl = '/api/bible-slides/jobs/' + job.id + '/deck';
    out.pdfUrl = '/api/bible-slides/jobs/' + job.id + '/pdf';
    out.pptxUrl = '/api/bible-slides/jobs/' + job.id + '/pptx';
    out.googleSlidesUrl = '/api/bible-slides/jobs/' + job.id + '/google-slides';
  }
  return out;
}

async function regenerateSlideImage(jobId, ownerKey, slideIndex, overridePrompt) {
  const job = getJob(jobId, ownerKey);
  if (!job || !job.script) throw jobNotFoundError();
  const i = Number(slideIndex) - 1;
  const slide = job.script.slides[i];
  if (!slide) {
    const err = new Error('Slide not found.');
    err.statusCode = 404;
    throw err;
  }
  if (overridePrompt && String(overridePrompt).trim()) {
    slide.imagePrompt = String(overridePrompt).trim();
  }
  const img = await paintSlide(job.script, slide, job.input.styleKey);
  job.images[i] = img;
  touch(job, {});
  schedulePersist(job, true);
  return { ok: true, slide: { index: slide.index, imageUrl: dataUri(img) } };
}

function updateCaption(jobId, ownerKey, slideIndex, caption) {
  const job = getJob(jobId, ownerKey);
  if (!job || !job.script) throw jobNotFoundError();
  const slide = job.script.slides[Number(slideIndex) - 1];
  if (!slide) {
    const err = new Error('Slide not found.');
    err.statusCode = 404;
    throw err;
  }
  slide.caption = normalizeCaption(caption);
  touch(job, {});
  schedulePersist(job, true);
  return { ok: true, slide: { index: slide.index, caption: slide.caption } };
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function captionHtml(caption) {
  return String(caption || '').split('\n').map((l) => '<span class="line">' + escapeHtml(l) + '</span>').join('');
}

/** Standalone 16:9 HTML slideshow (keyboard/click nav, print = one slide per page). */
function renderDeckHtml(job, opts) {
  opts = opts || {};
  const script = job.script;
  const slides = script.slides.map((s, i) => {
    const img = job.images[i];
    const src = dataUri(img);
    const isTitle = s.kind === 'title';
    const titleBlock = isTitle
      ? '<div class="title-block">'
        + '<div class="t-main">' + escapeHtml(script.title) + '</div>'
        + (script.scriptureRef ? '<div class="t-ref">' + escapeHtml(script.scriptureRef) + '</div>' : '')
        + (script.scriptureText ? '<div class="t-verse">“' + escapeHtml(script.scriptureText) + '”</div>' : '')
        + '</div>'
      : '';
    const cap = isTitle ? '' : '<div class="caption">' + captionHtml(s.caption) + '</div>';
    return '<section class="slide kind-' + s.kind + '" data-index="' + (i + 1) + '">'
      + (src ? '<img class="bg" src="' + src + '" alt="">' : '<div class="bg bg-empty"></div>')
      + '<div class="shade"></div>'
      + titleBlock + cap
      + '<div class="pagenum">' + (i + 1) + ' / ' + script.slides.length + '</div>'
      + '</section>';
  }).join('\n');

  const nav = opts.forPdf ? '' : `
<div class="hud">
  <button type="button" id="prevBtn" aria-label="이전">‹</button>
  <span id="counter">1 / ${script.slides.length}</span>
  <button type="button" id="nextBtn" aria-label="다음">›</button>
  <button type="button" id="fsBtn" title="전체화면">⛶</button>
  <button type="button" id="printBtn" title="인쇄 / PDF">🖨</button>
</div>`;

  const script_js = opts.forPdf ? '' : `
<script>
(function(){
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var i = 0;
  function show(n){
    i = Math.max(0, Math.min(slides.length-1, n));
    slides.forEach(function(s, k){ s.classList.toggle('active', k===i); });
    document.getElementById('counter').textContent = (i+1) + ' / ' + slides.length;
    try { history.replaceState(null, '', '#' + (i+1)); } catch(e){}
  }
  var h = parseInt((location.hash||'').replace('#',''), 10);
  show(isNaN(h) ? 0 : h-1);
  document.getElementById('prevBtn').onclick = function(){ show(i-1); };
  document.getElementById('nextBtn').onclick = function(){ show(i+1); };
  document.getElementById('fsBtn').onclick = function(){
    var el = document.documentElement;
    if (!document.fullscreenElement) { (el.requestFullscreen||el.webkitRequestFullscreen||function(){}).call(el); }
    else { (document.exitFullscreen||function(){}).call(document); }
  };
  document.getElementById('printBtn').onclick = function(){ window.print(); };
  document.addEventListener('keydown', function(e){
    if (e.key==='ArrowRight'||e.key===' '||e.key==='PageDown') { e.preventDefault(); show(i+1); }
    if (e.key==='ArrowLeft'||e.key==='PageUp') { e.preventDefault(); show(i-1); }
    if (e.key==='Home') show(0);
    if (e.key==='End') show(slides.length-1);
  });
  document.querySelector('.stage').addEventListener('click', function(e){
    if (e.target.closest('.hud')) return;
    var r = this.getBoundingClientRect();
    show((e.clientX - r.left) < r.width/3 ? i-1 : i+1);
  });
})();
</script>`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(script.title)} — 어린이 설교 슬라이드</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;700;900&family=Gowun+Dodum&display=swap" rel="stylesheet">
<style>
  :root { --cap-size: 2.6vw; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #0b0d12; font-family: 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
  .stage { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
  .slide {
    position: absolute; width: 100vw; height: 56.25vw; max-height: 100vh; max-width: 177.78vh;
    left: 50%; top: 50%; transform: translate(-50%, -50%);
    overflow: hidden; background: #111; opacity: 0; pointer-events: none; transition: opacity .35s ease;
  }
  .slide.active { opacity: 1; pointer-events: auto; }
  .slide .bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
  .bg-empty { background: linear-gradient(135deg, #f7d6a0, #7fb3ff); }
  .shade {
    position: absolute; left: 0; right: 0; bottom: 0; height: 42%;
    background: linear-gradient(to top, rgba(10,12,20,0.88) 0%, rgba(10,12,20,0.55) 55%, rgba(10,12,20,0) 100%);
  }
  .caption {
    position: absolute; left: 5%; right: 5%; bottom: 5.5%;
    color: #fff; font-weight: 700; font-size: var(--cap-size); line-height: 1.38;
    text-shadow: 0 2px 10px rgba(0,0,0,0.55), 0 0 2px rgba(0,0,0,0.9);
    letter-spacing: -0.01em; word-break: keep-all; text-align: center;
  }
  .caption .line { display: block; }
  .kind-title .shade { height: 100%; background: linear-gradient(to top, rgba(10,12,20,0.82) 0%, rgba(10,12,20,0.35) 45%, rgba(10,12,20,0.15) 100%); }
  .title-block {
    position: absolute; left: 7%; right: 7%; top: 50%; transform: translateY(-50%);
    text-align: center; color: #fff; text-shadow: 0 3px 14px rgba(0,0,0,0.6);
  }
  .t-main { font-size: 6.2vw; font-weight: 900; line-height: 1.15; letter-spacing: -0.02em; word-break: keep-all; }
  .t-ref { margin-top: 1.4vw; font-size: 2.6vw; font-weight: 700; color: #ffe08a; }
  .t-verse { margin-top: 1.6vw; font-size: 2.2vw; font-weight: 500; line-height: 1.5; word-break: keep-all; font-family: 'Gowun Dodum', 'Noto Sans KR', sans-serif; }
  .pagenum { position: absolute; right: 1.6%; top: 1.8%; font-size: 1.1vw; color: rgba(255,255,255,0.75); background: rgba(0,0,0,0.3); padding: 0.25em 0.7em; border-radius: 999px; }
  .hud {
    position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 6px; align-items: center;
    background: rgba(20,22,30,0.72); color: #fff; padding: 6px 10px; border-radius: 999px; font-size: 14px; z-index: 10;
    opacity: 0.25; transition: opacity .2s;
  }
  .hud:hover { opacity: 1; }
  .hud button { background: rgba(255,255,255,0.12); color: #fff; border: none; border-radius: 999px; width: 32px; height: 32px; cursor: pointer; font-size: 18px; line-height: 1; }
  .hud button:hover { background: rgba(255,255,255,0.25); }
  @media (max-aspect-ratio: 16/9) { :root { --cap-size: 2.6vw; } }
  @media (min-aspect-ratio: 16/9) {
    :root { --cap-size: 4.6vh; }
    .t-main { font-size: 11vh; } .t-ref { font-size: 4.6vh; } .t-verse { font-size: 3.9vh; } .pagenum { font-size: 2vh; }
  }
  @page { size: 338.67mm 190.5mm; margin: 0; }
  @media print {
    html, body { background: #fff; height: auto; }
    .stage { position: static; display: block; }
    .hud { display: none !important; }
    .slide {
      position: relative; opacity: 1 !important; pointer-events: auto; transform: none; left: auto; top: auto;
      width: 338.67mm; height: 190.5mm; max-width: none; max-height: none; page-break-after: always; break-after: page;
      transition: none;
    }
    .slide:last-child { page-break-after: auto; break-after: auto; }
    :root { --cap-size: 9mm; }
    .t-main { font-size: 21mm; } .t-ref { font-size: 9mm; } .t-verse { font-size: 7.5mm; } .pagenum { font-size: 3.6mm; }
  }
  ${opts.forPdf ? `
    html, body { background: #fff; height: auto; }
    .stage { position: static; display: block; }
    .slide { position: relative; opacity: 1; pointer-events: auto; transform: none; left: auto; top: auto;
      width: 338.67mm; height: 190.5mm; max-width: none; max-height: none; page-break-after: always; break-after: page; }
    .slide:last-child { page-break-after: auto; break-after: auto; }
    :root { --cap-size: 9mm; }
    .t-main { font-size: 21mm; } .t-ref { font-size: 9mm; } .t-verse { font-size: 7.5mm; } .pagenum { font-size: 3.6mm; }
  ` : ''}
</style>
</head>
<body>
<div class="stage">
${slides}
${nav}
</div>
${script_js}
</body>
</html>`;
}

async function renderDeckPdf(job) {
  let chromium;
  let puppeteer;
  try {
    chromium = require('@sparticuz/chromium');
    puppeteer = require('puppeteer-core');
  } catch (e) {
    const err = new Error('PDF engine is not installed on this server. Use 발표 모드 → 인쇄 → PDF로 저장 하세요.');
    err.statusCode = 503;
    throw err;
  }
  const html = renderDeckHtml(job, { forPdf: true });
  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1600, height: 900 },
    executablePath,
    headless: chromium.headless
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 90000 });
    const pdf = await page.pdf({
      width: '338.67mm',
      height: '190.5mm',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => {});
  }
}

function pptxImageData(img) {
  if (!img || !img.data) return null;
  if (/svg/i.test(img.mimeType || '')) return null; // pptxgenjs needs raster
  const mime = img.mimeType || 'image/png';
  return 'data:' + mime + ';base64,' + img.data;
}

async function renderDeckPptx(job) {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE16x9', width: 13.333, height: 7.5 });
  pptx.layout = 'WIDE16x9';
  pptx.author = 'Salt Morning Class Tools';
  pptx.title = (job.script && job.script.title) || 'Bible Slides';

  const script = job.script;
  script.slides.forEach((s, i) => {
    const slide = pptx.addSlide();
    const imgData = pptxImageData(job.images[i]);
    if (imgData) {
      slide.addImage({ data: imgData, x: 0, y: 0, w: '100%', h: '100%' });
    } else {
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: '100%', h: '100%',
        fill: { color: '1A1F2E' }
      });
    }

    // Soft gradient bar at bottom for captions (simulate with semi-opaque rect)
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 5.15, w: '100%', h: 2.35,
      fill: { color: '0A0C14', transparency: 35 }
    });

    if (s.kind === 'title') {
      slide.addText(script.title || '', {
        x: 0.6, y: 2.2, w: 12.1, h: 1.4,
        fontSize: 40, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle',
        fontFace: 'Arial',
        shadow: { type: 'outer', color: '000000', blur: 8, opacity: 0.45 }
      });
      if (script.scriptureRef) {
        slide.addText(script.scriptureRef, {
          x: 0.6, y: 3.55, w: 12.1, h: 0.45,
          fontSize: 18, bold: true, color: 'FFE08A', align: 'center', fontFace: 'Arial'
        });
      }
      if (script.scriptureText) {
        slide.addText('“' + script.scriptureText + '”', {
          x: 1.2, y: 4.15, w: 10.9, h: 0.9,
          fontSize: 16, color: 'FFFFFF', align: 'center', fontFace: 'Arial', italic: true
        });
      }
    } else {
      const lines = String(s.caption || '').split('\n').filter(Boolean);
      slide.addText(lines.map((t) => ({ text: t, options: { breakLine: true } })), {
        x: 0.7, y: 5.45, w: 11.9, h: 1.7,
        fontSize: lines.length >= 3 ? 18 : 22,
        bold: true, color: 'FFFFFF', align: 'center', valign: 'middle',
        fontFace: 'Arial',
        shadow: { type: 'outer', color: '000000', blur: 6, opacity: 0.5 }
      });
    }

    slide.addText((i + 1) + ' / ' + script.slides.length, {
      x: 11.6, y: 0.18, w: 1.5, h: 0.35,
      fontSize: 11, color: 'FFFFFF', align: 'right', fontFace: 'Arial',
      transparency: 20
    });
  });

  const buf = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(buf);
}

async function uploadToGoogleSlides(job, teacherId) {
  const {
    getGoogleStatus,
    getAccessToken,
    shareDriveFile
  } = require('./googleTeacherAuthService');

  let status;
  try {
    status = await getGoogleStatus(teacherId);
  } catch (_) {
    status = { connected: false };
  }
  if (!status || !status.connected) {
    const err = new Error('교사 포털에서 Google 계정을 먼저 연결해 주세요. (Drive)');
    err.statusCode = 400;
    err.code = 'GOOGLE_NOT_CONNECTED';
    throw err;
  }

  const pptxBuf = await renderDeckPptx(job);
  const { google } = require('googleapis');
  const tokenInfo = await getAccessToken(teacherId);
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: tokenInfo.accessToken });
  const drive = google.drive({ version: 'v3', auth });
  const name = ((job.script && job.script.title) || 'Bible Slides') + ' — 어린이 설교';
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.presentation'
    },
    media: {
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      body: Readable.from(pptxBuf)
    },
    fields: 'id, webViewLink, name'
  });
  const fileId = created.data && created.data.id;
  let webViewLink = created.data && created.data.webViewLink;
  try {
    const shared = await shareDriveFile(teacherId, fileId);
    webViewLink = shared.webViewLink || webViewLink;
  } catch (_) { /* optional */ }

  return {
    url: webViewLink || ('https://docs.google.com/presentation/d/' + fileId + '/edit'),
    fileId,
    name: (created.data && created.data.name) || name
  };
}

function safeFilename(title) {
  const base = String(title || 'bible-slides').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'bible-slides';
  return base;
}

module.exports = {
  STYLE_PRESETS,
  AUDIENCE_PRESETS,
  LANGUAGE_PRESETS,
  startJob,
  getJob,
  publicJob,
  regenerateSlideImage,
  updateCaption,
  renderDeckHtml,
  renderDeckPdf,
  renderDeckPptx,
  uploadToGoogleSlides,
  jobNotFoundError,
  safeFilename,
  isClaudeConfigured,
  isImageGenConfigured
};
