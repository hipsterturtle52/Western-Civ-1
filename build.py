#!/usr/bin/env python3
"""Build the single-file CLEP Western Civilization I study guide.

Reads outline.json, src/units/*.txt (lesson, must-know, timeline, people, cards)
and src/questions/*.txt (question bank), validates everything, assigns each
question to exactly one pool (diag / quiz / pe1 / pe2) stratified by
difficulty, balances correct-answer positions, and inlines it all into
src/template.html -> clep-western-civilization-i-study-guide.html.
"""
import glob
import html
import json
import os
import random
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "clep-western-civilization-i-study-guide.html")
DIFFS = {"e": "easy", "m": "medium", "h": "hard"}


def die(msg):
    print("BUILD ERROR:", msg)
    sys.exit(1)


# ---------- tiny markdown ----------
def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", s)
    s = s.replace("--", "&ndash;").replace("-&gt;", "&rarr;")
    return s


def md(text):
    out, para, lst, tbl = [], [], [], []

    def flush():
        if para:
            out.append("<p>" + inline(" ".join(para)) + "</p>")
            para.clear()
        if lst:
            out.append("<ul>" + "".join("<li>" + inline(x) + "</li>" for x in lst) + "</ul>")
            lst.clear()
        if tbl:
            rows = [[c.strip() for c in r.strip().strip("|").split("|")] for r in tbl
                    if not re.match(r"^\|?\s*:?-{3,}", r.strip())]
            h = "".join("<th>" + inline(c) + "</th>" for c in rows[0])
            b = "".join("<tr>" + "".join("<td>" + inline(c) + "</td>" for c in r) + "</tr>" for r in rows[1:])
            out.append('<div class="tblwrap"><table><thead><tr>' + h + "</tr></thead><tbody>" + b + "</tbody></table></div>")
            tbl.clear()

    for line in text.splitlines():
        s = line.rstrip()
        if not s.strip():
            flush()
            continue
        if s.startswith("### "):
            flush(); out.append("<h4>" + inline(s[4:]) + "</h4>")
        elif s.startswith("## "):
            flush(); out.append("<h3>" + inline(s[3:]) + "</h3>")
        elif s.startswith(">> "):
            # cause -> event -> consequence chain:  >> Cause | Event | Consequence
            flush()
            parts = [p.strip() for p in s[3:].split("|")]
            labels = ["Cause", "Event", "Consequence"]
            cells = "".join('<div class="chain-step"><span class="chain-lbl">%s</span>%s</div>' % (labels[i] if i < 3 else "", inline(p))
                            for i, p in enumerate(parts))
            out.append('<div class="chain">' + cells + "</div>")
        elif s.startswith("> "):
            flush(); out.append("<blockquote>" + inline(s[2:]) + "</blockquote>")
        elif s.lstrip().startswith("|"):
            if para:
                out.append("<p>" + inline(" ".join(para)) + "</p>"); para.clear()
            if lst:
                out.append("<ul>" + "".join("<li>" + inline(x) + "</li>" for x in lst) + "</ul>"); lst.clear()
            tbl.append(s)
        elif s.startswith("- "):
            if para:
                out.append("<p>" + inline(" ".join(para)) + "</p>"); para.clear()
            lst.append(s[2:])
        else:
            if lst:
                out.append("<ul>" + "".join("<li>" + inline(x) + "</li>" for x in lst) + "</ul>"); lst.clear()
            para.append(s.strip())
    flush()
    return "\n".join(out)


# ---------- unit files ----------
def sections(text):
    secs, cur = {}, None
    for line in text.splitlines():
        m = re.match(r"^=== (\w+)\s*$", line)
        if m:
            cur = m.group(1)
            secs[cur] = []
        elif cur:
            secs[cur].append(line)
    return {k: "\n".join(v).strip() for k, v in secs.items()}


def parse_unit(path, plan):
    s = sections(open(path, encoding="utf-8").read())
    meta = dict(l.split(":", 1) for l in s["meta"].splitlines() if ":" in l)
    meta = {k.strip(): v.strip() for k, v in meta.items()}
    uid = meta["id"]
    p = next((u for u in plan if u["id"] == uid), None)
    if not p:
        die("unit %s not in outline unit_plan" % uid)
    timeline = []
    for l in s.get("timeline", "").splitlines():
        if not l.strip():
            continue
        parts = [x.strip() for x in l.split("|")]
        if len(parts) != 3:
            die("%s timeline line malformed: %s" % (uid, l))
        key = parts[0].startswith("*")
        timeline.append({"y": float(parts[0].lstrip("*")), "label": parts[1], "text": inline(parts[2]), "key": key})
    timeline.sort(key=lambda t: t["y"])
    people = []
    for l in s.get("people", "").splitlines():
        if l.strip():
            n, d = [x.strip() for x in l.split("|", 1)]
            people.append({"name": n, "desc": inline(d)})
    cards = []
    for i, l in enumerate([l for l in s.get("cards", "").splitlines() if l.strip()]):
        if "::" not in l:
            die("%s card malformed: %s" % (uid, l))
        f, b = [x.strip() for x in l.split("::", 1)]
        cards.append({"id": "%s-c%d" % (uid, i + 1), "f": inline(f), "b": inline(b)})
    mk = [inline(l[2:].strip()) for l in s.get("mustknow", "").splitlines() if l.startswith("- ")]
    lesson = s.get("lesson", "")
    words = len(re.findall(r"\w+", lesson))
    return {
        "id": uid, "title": p["title"], "topic": p["topic"], "share": p["share"],
        "quizN": p["quiz"], "examN": p["exam_each"], "diagN": p["diag"], "cardTarget": p["cards"],
        "lessonMin": max(10, round(words / 170)), "studyHours": p["study_hours"],
        "intro": inline(meta.get("intro", "")), "lesson": md(lesson), "words": words,
        "mustKnow": mk, "timeline": timeline, "people": people, "cards": cards,
        "compare": md(s.get("compare", "")),
    }


# ---------- questions ----------
def parse_questions(path, uid):
    text = open(path, encoding="utf-8").read()
    blocks = re.split(r"\n\s*\n(?=Q )", "\n" + text.strip())
    qs = []
    for b in blocks:
        lines = [l.rstrip() for l in b.strip().splitlines() if l.strip()]
        if not lines:
            continue
        head = lines[0].split()
        if head[0] != "Q" or len(head) < 2 or head[1] not in DIFFS:
            die("%s: bad question header %r" % (path, lines[0]))
        fixed = "fixed" in head[2:]
        stem, passage, opts = [], [], []
        for l in lines[1:]:
            if l.startswith("+ ") or l.startswith("- "):
                if "::" not in l:
                    die("%s: option missing explanation: %s" % (path, l))
                t, why = [x.strip() for x in l[2:].split("::", 1)]
                if not t or not why:
                    die("%s: empty option/explanation: %s" % (path, l))
                opts.append({"t": t, "why": why, "ok": l.startswith("+")})
            elif l.startswith("> ") or l.startswith("|"):
                passage.append(l)
            else:
                if opts:
                    die("%s: text after options: %s" % (path, l))
                stem.append(l.strip())
        if len(opts) != 5:
            die("%s: question needs 5 options, has %d: %s" % (path, len(opts), " ".join(stem)[:80]))
        if sum(o["ok"] for o in opts) != 1:
            die("%s: question needs exactly one correct option: %s" % (path, " ".join(stem)[:80]))
        if len({o["t"].lower() for o in opts}) != 5:
            die("%s: duplicate options: %s" % (path, " ".join(stem)[:80]))
        for o in opts:
            if re.search(r"\ball of the above\b|\bnone of the above\b", o["t"], re.I):
                die("%s: 'all/none of the above' not allowed" % path)
        ptxt = ""
        if passage:
            if passage[0].startswith("|"):
                ptxt = md("\n".join(passage))
            else:
                ptxt = "<blockquote>" + "<br>".join(inline(p[2:]) for p in passage) + "</blockquote>"
        qs.append({"u": uid, "d": head[1], "fixed": fixed, "q": inline(" ".join(stem)),
                   "p": ptxt, "opts": opts, "raw": " ".join(stem)})
    return qs


def assign_pools(qs, sizes, rng):
    """Deal questions into pools so each pool gets a proportional slice of each difficulty."""
    order = []
    for d in "emh":
        grp = [q for q in qs if q["d"] == d]
        rng.shuffle(grp)
        order += grp
    total = sum(sizes.values())
    if len(order) != total:
        return "unit %s has %d questions, plan needs %d" % (qs[0]["u"] if qs else "?", len(order), total)
    counts = {k: 0 for k in sizes}
    for i, q in enumerate(order):
        best = max(sizes, key=lambda k: (sizes[k] * (i + 1) / total - counts[k], sizes[k]))
        q["pool"] = best
        counts[best] += 1
    return None


def balance_positions(qs, rng):
    movable = [q for q in qs if not q["fixed"]]
    fixed_pos = [next(i for i, o in enumerate(q["opts"]) if o["ok"]) for q in qs if q["fixed"]]
    need = [0] * 5
    for p in fixed_pos:
        need[p] -= 1
    targets = []
    n = len(qs)
    per = [n // 5 + (1 if i < n % 5 else 0) for i in range(5)]
    for i in range(5):
        targets += [i] * max(0, per[i] + need[i])
    while len(targets) < len(movable):
        targets.append(rng.randrange(5))
    rng.shuffle(targets)
    for q, t in zip(movable, targets):
        right = next(o for o in q["opts"] if o["ok"])
        wrong = [o for o in q["opts"] if not o["ok"]]
        wrong.insert(t, right)
        q["opts"] = wrong


def main():
    outline = json.load(open(os.path.join(ROOT, "outline.json"), encoding="utf-8"))
    plan = outline["unit_plan"]["units"]
    units = []
    for path in sorted(glob.glob(os.path.join(ROOT, "src/units/*.txt"))):
        units.append(parse_unit(path, plan))
    order = [u["id"] for u in plan]
    units.sort(key=lambda u: order.index(u["id"]))

    rng = random.Random(1648)
    questions, problems = [], []
    for u in units:
        qpath = os.path.join(ROOT, "src/questions/%s.txt" % u["id"])
        qs = parse_questions(qpath, u["id"]) if os.path.exists(qpath) else []
        if qs:
            err = assign_pools(qs, {"diag": u["diagN"], "quiz": u["quizN"], "pe1": u["examN"], "pe2": u["examN"]}, rng)
            if err:
                problems.append(err)
                # partial bank during staged build: fill quiz first, then the rest
                for i, q in enumerate(qs):
                    q["pool"] = "quiz" if i < u["quizN"] else ("diag" if i < u["quizN"] + u["diagN"] else ("pe1" if i % 2 else "pe2"))
        questions += qs

    # stable ids, then balance answer positions per pool
    for i, q in enumerate(questions):
        q["id"] = "%s-q%03d" % (q["u"], i + 1)
    for pool in ("diag", "quiz", "pe1", "pe2"):
        balance_positions([q for q in questions if q.get("pool") == pool], rng)

    pools = {}
    for pool in ("diag", "pe1", "pe2"):
        ids = [q["id"] for q in questions if q.get("pool") == pool]
        rng.shuffle(ids)
        pools[pool] = ids

    out_q = [{"id": q["id"], "u": q["u"], "d": q["d"], "pool": q["pool"], "q": q["q"], "p": q["p"],
              "o": [inline(o["t"]) for o in q["opts"]], "a": next(i for i, o in enumerate(q["opts"]) if o["ok"]),
              "w": [inline(o["why"]) for o in q["opts"]]} for q in questions]

    data = {"outline": outline, "units": units, "questions": out_q, "pools": pools,
            "built": __import__("datetime").date.today().isoformat()}
    tpl = open(os.path.join(ROOT, "src/template.html"), encoding="utf-8").read()
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    if "/*__DATA__*/null" not in tpl:
        die("template missing data placeholder")
    open(OUT, "w", encoding="utf-8").write(tpl.replace("/*__DATA__*/null", js))

    # ---------- report ----------
    print("Built %s (%.0f KB)" % (os.path.basename(OUT), os.path.getsize(OUT) / 1024))
    print("%-5s %6s %6s %5s %5s %5s %5s %5s  %s" % ("unit", "share", "words", "Qs", "e", "m", "h", "cards", "pools(diag/quiz/pe1/pe2)"))
    for u in units:
        uq = [q for q in questions if q["u"] == u["id"]]
        dc = {d: sum(q["d"] == d for q in uq) for d in "emh"}
        pc = "/".join(str(sum(q.get("pool") == p for q in uq)) for p in ("diag", "quiz", "pe1", "pe2"))
        print("%-5s %5.1f%% %6d %5d %5d %5d %5d %5d  %s" % (u["id"], u["share"], u["words"], len(uq), dc["e"], dc["m"], dc["h"], len(u["cards"]), pc))
    if questions:
        pos = [0] * 5
        for q in out_q:
            pos[q["a"]] += 1
        print("answer positions A-E:", pos, " total questions:", len(questions))
    for p in problems:
        print("WARN:", p)


if __name__ == "__main__":
    main()
