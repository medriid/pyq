/* PYQ Export Viewer (static)
 *
 * Requires a generated catalog.json at the same directory level as this file.
 * catalog.json format:
 * {
 *   "generated_at": "...",
 *   "root": ".",
 *   "exams": [
 *     {
 *       "name": "jee_main__14daf",
 *       "display": "JEE Main (id=...)",   // optional
 *       "subjects": [
 *         {
 *           "name": "physics__14dab",
 *           "chapters": [
 *             {
 *               "name": "center_of_mass__af460",
 *               "path": "jee_main__14daf/physics__14dab/center_of_mass__af460",
 *               "chapter_index": "jee_main__.../physics__.../center.../chapter_index.json"
 *             }
 *           ]
 *         }
 *       ]
 *     }
 *   ]
 * }
 */

const $ = (id) => document.getElementById(id);

const state = {
  catalog: null,
  exam: null,
  subject: null,
  chapter: null,
  chapterIndex: null,
  year: null,
  shift: null,
  questionPaths: [],
  filteredPaths: [],
  activeQ: null,
  search: ""
};

function escapeHtml(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll("\"","&quot;")
    .replaceAll("'","&#039;");
}

async function fetchJson(path){
  const res = await fetch(path, { cache: "no-cache" });
  if(!res.ok) throw new Error(`Failed fetch ${path}: HTTP ${res.status}`);
  return await res.json();
}

function looksLikeHtml(text){
  return /<\/?[a-z][\s\S]*>/i.test(text);
}

function normalizeAssetPath(pathOrUrl, base){
  if(!pathOrUrl) return "";
  const clean = pathOrUrl.replaceAll("\\","/");
  if(clean.startsWith("assets/")) return `${base}/${clean}`;
  return clean;
}

function normalizeHtmlContent(raw, base){
  if(!raw) return "";
  if(!looksLikeHtml(raw)){
    return escapeHtml(raw).replace(/\n/g, "<br />");
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, "text/html");
  doc.querySelectorAll("img[src]").forEach((img) => {
    const src = img.getAttribute("src");
    const next = normalizeAssetPath(src, base);
    if(next) img.setAttribute("src", next);
  });
  doc.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href");
    const next = normalizeAssetPath(href, base);
    if(next) link.setAttribute("href", next);
  });
  return doc.body.innerHTML;
}

function typesetMath(){
  if(!window.MathJax || !window.MathJax.typesetPromise) return;
  const el = $("viewer");
  if(!el) return;
  if(window.MathJax.typesetClear) window.MathJax.typesetClear([el]);
  window.MathJax.typesetPromise([el]).catch(() => {});
}

function withCatalogRoot(relPath){
  const root = state.catalog?.root;
  if(!root || root === ".") return relPath;
  const cleanRoot = root.replace(/\/+$/,"");
  const cleanRel = relPath.replace(/^\/+/,"");
  if(cleanRel === cleanRoot || cleanRel.startsWith(`${cleanRoot}/`)) return cleanRel;
  return `${cleanRoot}/${cleanRel}`;
}

function getChapterBasePath(){
  return state.chapter ? withCatalogRoot(state.chapter.path) : "";
}

function setOptions(selectEl, items, getValue, getLabel){
  selectEl.innerHTML = "";
  for(const it of items){
    const opt = document.createElement("option");
    opt.value = getValue(it);
    opt.textContent = getLabel(it);
    selectEl.appendChild(opt);
  }
}

function uniq(arr){
  return [...new Set(arr)];
}

function parseYearShift(relPath){
  // relPath like "2005/shift_1/q_0119" or "unknown_year/unknown_shift/q_0000"
  const parts = relPath.split("/");
  return { year: parts[0] || "unknown_year", shift: parts[1] || "unknown_shift" };
}

function applyFilters(){
  const yearSel = state.year || "all";
  const shiftSel = state.shift || "all";

  let paths = state.questionPaths;

  if(yearSel !== "all" || shiftSel !== "all"){
    paths = paths.filter(p => {
      const {year, shift} = parseYearShift(p);
      if(yearSel !== "all" && year !== yearSel) return false;
      if(shiftSel !== "all" && shift !== shiftSel) return false;
      return true;
    });
  }

  const q = state.search.trim().toLowerCase();
  state.filteredPaths = paths;

  // Search is applied by preloading minimal question text snippets on-demand.
  // For speed, we filter by folder name if no search; if search, we do a best-effort async filter.
  renderQuestionList();
  if(q){
    bestEffortSearchFilter(q);
  }
}

async function bestEffortSearchFilter(q){
  // Limit how many we scan to keep UI responsive (adjust as needed).
  const LIMIT = 250;
  const paths = state.filteredPaths.slice(0, LIMIT);
  const keep = [];

  for(let i=0;i<paths.length;i++){
    const rel = paths[i];
    try{
      const payloadPath = `${getChapterBasePath()}/${rel}/payload.json`;
      const data = await fetchJson(payloadPath);
      const text = JSON.stringify({
        q: data.question?.text || "",
        s: data.solution?.text || "",
        pyq: data.pyq_info || ""
      }).toLowerCase();
      if(text.includes(q)) keep.push(rel);
    }catch(e){
      // ignore
    }
  }

  // If the user changes selection mid-search, abort silently.
  if(state.search.trim().toLowerCase() !== q) return;

  state.filteredPaths = keep;
  renderQuestionList(true);
}

function renderMeta(){
  const el = $("chapterMeta");
  if(!state.chapterIndex){
    el.textContent = "";
    return;
  }
  const ci = state.chapterIndex;
  el.innerHTML = `
    <div><b>Exam:</b> ${escapeHtml(ci.exam_name || ci.exam_id)}</div>
    <div><b>Subject:</b> ${escapeHtml(ci.subject_name || ci.subject_id)}</div>
    <div><b>Chapter:</b> ${escapeHtml(ci.chapter_name || ci.chapter_id)}</div>
    <div><b>Exported:</b> ${ci.questions_exported} questions</div>
  `;
}

function renderQuestionList(isSearchResult=false){
  const list = $("qList");
  list.innerHTML = "";

  const paths = state.filteredPaths.length ? state.filteredPaths : [];
  if(!paths.length){
    const empty = document.createElement("div");
    empty.className = "q-item";
    empty.innerHTML = `<div class="q-title">${isSearchResult ? "No search matches." : "No questions in this selection."}</div>`;
    list.appendChild(empty);
    return;
  }

  for(const rel of paths){
    const item = document.createElement("div");
    item.className = "q-item" + (state.activeQ === rel ? " active" : "");
    const parts = rel.split("/");
    const qid = parts[2] || rel; // q_0123
    const ys = `${parts[0]}/${parts[1]}`;
    item.innerHTML = `
      <div>
        <div class="q-title">${escapeHtml(qid)}</div>
        <div class="q-id">${escapeHtml(ys)}</div>
      </div>
      <div class="q-id">open</div>
    `;
    item.addEventListener("click", () => openQuestion(rel));
    list.appendChild(item);
  }
}

function setViewerHtml(html){
  $("viewer").innerHTML = html;
  requestAnimationFrame(typesetMath);
}

function htmlBlock(title, inner){
  return `<div class="block"><h3>${escapeHtml(title)}</h3>${inner}</div>`;
}

function renderImageMaybe(pathOrUrl){
  if(!pathOrUrl) return "";
  // payload uses "assets/..." relative to question folder
  return `<div style="margin-top:8px"><img loading="lazy" decoding="async" src="${pathOrUrl}" alt="" /></div>`;
}

async function openQuestion(rel){
  state.activeQ = rel;
  renderQuestionList();

  setViewerHtml(`<div class="hint">Loading ${escapeHtml(rel)}...</div>`);

  const base = `${getChapterBasePath()}/${rel}`;
  const payloadPath = `${base}/payload.json`;

  try{
    const data = await fetchJson(payloadPath);

    // Fix asset-relative image paths: "assets/x.png" => "<base>/assets/x.png"
    const fixAsset = (p) => {
      return normalizeAssetPath(p, base);
    };

    const qText = normalizeHtmlContent(data.question?.text || "", base);
    const qImg = fixAsset(data.question?.image);

    let qHtml = "";
    if(qText) qHtml += `<div class="qhtml">${qText}</div>`;
    if(qImg) qHtml += renderImageMaybe(qImg);

    const options = Array.isArray(data.options) ? data.options : [];
    const letters = ["A","B","C","D","E","F"];
    let optHtml = "";
    for(let i=0;i<options.length;i++){
      const o = options[i] || {};
      const badge = o.is_correct ? `<span class="badge good">correct</span>` : `<span class="badge">option</span>`;
      const label = letters[i] || String(i+1);
      const oText = normalizeHtmlContent(o.text || "", base);
      const oImg = fixAsset(o.image);
      optHtml += `
        <div class="opt">
          <div style="min-width:48px"><span class="badge">${escapeHtml(label)}</span></div>
          <div style="flex:1">
            <div>${badge}</div>
            ${oText ? `<div class="qhtml" style="margin-top:6px">${oText}</div>` : ""}
            ${oImg ? renderImageMaybe(oImg) : ""}
          </div>
        </div>
      `;
    }

    const solText = normalizeHtmlContent(data.solution?.text || "", base);
    const solImg = fixAsset(data.solution?.image);
    let solHtml = "";
    if(solText) solHtml += `<div class="qhtml">${solText}</div>`;
    if(solImg) solHtml += renderImageMaybe(solImg);

    const correct = data.correct_answer;
    const correctStr = Array.isArray(correct) ? correct.join(", ") : (correct ?? "");

    const header = `
      <div class="block">
        <h3>Metadata</h3>
        <div><small><b>Type:</b> ${escapeHtml(data.type || "")} &nbsp; <b>Difficulty:</b> ${escapeHtml(data.difficulty ?? "")}</small></div>
        <div><small><b>PYQ:</b> ${escapeHtml(data.pyq_info || "")}</small></div>
        <div><small><b>Correct:</b> ${escapeHtml(String(correctStr))}</small></div>
        <div><small><b>Path:</b> ${escapeHtml(rel)}</small></div>
      </div>
    `;

    const full = [
      header,
      htmlBlock("Question", qHtml || `<div class="hint">No question text/image.</div>`),
      htmlBlock("Options", optHtml || `<div class="hint">No options.</div>`),
      htmlBlock("Solution", solHtml || `<div class="hint">No solution text/image.</div>`),
    ].join("\n");

    setViewerHtml(full);
  }catch(e){
    setViewerHtml(`<div class="hint">Failed to load question: ${escapeHtml(String(e))}</div>`);
  }
}

async function loadChapterIndex(){
  state.chapterIndex = null;
  state.questionPaths = [];
  state.filteredPaths = [];
  state.activeQ = null;

  $("yearSelect").innerHTML = "";
  $("shiftSelect").innerHTML = "";
  $("qList").innerHTML = "";
  setViewerHtml(`<div class="hint">Loading chapter index...</div>`);

  const ciPath = withCatalogRoot(state.chapter.chapter_index);
  try{
    const ci = await fetchJson(ciPath);
    state.chapterIndex = ci;
    state.questionPaths = Array.isArray(ci.question_paths) ? ci.question_paths : [];

    // Build year/shift drop-downs from question_paths
    const ys = state.questionPaths.map(parseYearShift);
    const years = uniq(ys.map(x => x.year)).sort();
    const shifts = uniq(ys.map(x => x.shift)).sort();

    const yearItems = [{v:"all", t:"All years"}, ...years.map(y=>({v:y,t:y}))];
    const shiftItems = [{v:"all", t:"All shifts"}, ...shifts.map(s=>({v:s,t:s}))];

    setOptions($("yearSelect"), yearItems, x=>x.v, x=>x.t);
    setOptions($("shiftSelect"), shiftItems, x=>x.v, x=>x.t);

    state.year = "all";
    state.shift = "all";
    state.search = "";
    $("qSearch").value = "";

    renderMeta();
    applyFilters();
    setViewerHtml(`<div class="hint">Pick a question from the list.</div>`);
  }catch(e){
    renderMeta();
    setViewerHtml(`<div class="hint">Failed to load chapter_index.json: ${escapeHtml(String(e))}</div>`);
  }
}

function findByName(list, name){
  return list.find(x => x.name === name) || null;
}

async function boot(){
  setViewerHtml(`<div class="hint">Loading catalog.json...</div>`);

  try{
    state.catalog = await fetchJson("./catalog.json");
  }catch(e){
    setViewerHtml(`<div class="hint">
      <div><b>Missing catalog.json</b></div>
      <div style="margin-top:8px">Generate it by running <code>python make_catalog.py</code> in your export folder, then deploy again.</div>
      <div style="margin-top:8px"><small>${escapeHtml(String(e))}</small></div>
    </div>`);
    return;
  }

  const exams = state.catalog.exams || [];
  if(!exams.length){
    setViewerHtml(`<div class="hint">catalog.json has no exams.</div>`);
    return;
  }

  const catalogUrl = new URL("catalog.json", window.location.href).toString();
  const rootPath = state.catalog.root && state.catalog.root !== "." ? state.catalog.root : "/";
  const rootUrl = new URL(rootPath.replace(/\/+$/,"") + "/", window.location.href).toString();
  const dataCatalogEl = $("dataCatalogUrl");
  const dataRootEl = $("dataRootUrl");
  if(dataCatalogEl){
    dataCatalogEl.textContent = catalogUrl;
    dataCatalogEl.href = catalogUrl;
  }
  if(dataRootEl){
    dataRootEl.textContent = rootUrl;
  }
  window.PYQ_EXPORT = {
    catalog: catalogUrl,
    root: rootUrl
  };

  // Wire selects
  const examSel = $("examSelect");
  const subjSel = $("subjectSelect");
  const chapSel = $("chapterSelect");

  setOptions(examSel, exams, e=>e.name, e=>e.display || e.name);

  examSel.addEventListener("change", () => {
    state.exam = findByName(exams, examSel.value);
    hydrateSubjects();
  });

  subjSel.addEventListener("change", () => {
    state.subject = findByName(state.exam.subjects || [], subjSel.value);
    hydrateChapters();
  });

  chapSel.addEventListener("change", () => {
    state.chapter = findByName(state.subject.chapters || [], chapSel.value);
    loadChapterIndex();
  });

  $("yearSelect").addEventListener("change", (ev) => {
    state.year = ev.target.value;
    applyFilters();
  });

  $("shiftSelect").addEventListener("change", (ev) => {
    state.shift = ev.target.value;
    applyFilters();
  });

  $("qSearch").addEventListener("input", (ev) => {
    state.search = ev.target.value || "";
    applyFilters();
  });

  $("clearSearch").addEventListener("click", () => {
    state.search = "";
    $("qSearch").value = "";
    applyFilters();
  });

  // Init default selections
  state.exam = exams[0];
  hydrateSubjects(true);
}

function hydrateSubjects(initial=false){
  const subjSel = $("subjectSelect");
  const chapSel = $("chapterSelect");

  const subjects = state.exam.subjects || [];
  setOptions(subjSel, subjects, s=>s.name, s=>s.display || s.name);

  state.subject = subjects[0] || null;
  chapSel.innerHTML = "";
  $("qList").innerHTML = "";
  $("chapterMeta").textContent = "";
  setViewerHtml(`<div class="hint">Select a chapter.</div>`);

  hydrateChapters(initial);
}

function hydrateChapters(initial=false){
  const chapSel = $("chapterSelect");
  const chapters = (state.subject && state.subject.chapters) ? state.subject.chapters : [];
  setOptions(chapSel, chapters, c=>c.name, c=>c.display || c.name);

  state.chapter = chapters[0] || null;
  $("qList").innerHTML = "";
  $("chapterMeta").textContent = "";
  if(state.chapter){
    loadChapterIndex();
  }else{
    setViewerHtml(`<div class="hint">No chapters.</div>`);
  }
}

boot();
