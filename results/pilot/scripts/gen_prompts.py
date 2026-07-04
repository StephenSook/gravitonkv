#!/usr/bin/env python3
"""Generate deterministic fill prompts sized by the model tokenizer, plus the
needle-in-haystack probe. No randomness (index-math variation only).

Usage: gen_prompts.py <llama-tokenize-bin> <model.gguf> <out-dir>
Outputs: fill_2048.txt fill_8192.txt fill_16384.txt needle_8192.txt needle_codes.txt
"""
import subprocess, sys, os, re, tempfile

TOK_BIN, MODEL, OUT = sys.argv[1], sys.argv[2], sys.argv[3]

SUBJECTS = ["The harbor authority", "A municipal survey", "The northern railway", "An archival ledger",
            "The village cooperative", "A coastal observatory", "The regional assembly", "An engineering corps",
            "The botanical society", "A cartography office"]
VERBS = ["recorded", "documented", "measured", "catalogued", "inspected", "reported", "surveyed", "audited"]
OBJECTS = ["seventeen shipments of timber", "the annual rainfall figures", "a revised boundary map",
           "the census of river traffic", "three new irrigation channels", "the inventory of grain stores",
           "a proposal for bridge repairs", "the migration of seabirds", "the yield of terraced fields",
           "a schedule of lighthouse maintenance"]
TAILS = ["before the winter session began.", "despite objections from the council.",
         "which was later confirmed by inspectors.", "according to the standard procedure.",
         "and filed the findings in the eastern archive.", "over a period of forty days.",
         "with assistance from neighboring districts.", "under the supervision of the registrar."]

def sentence(i):
    return " ".join([SUBJECTS[i % 10], VERBS[(i // 10) % 8], OBJECTS[(i // 80) % 10], TAILS[(i // 800) % 8]])

def make_text(n_sentences, start=0):
    return " ".join(sentence(start + i) for i in range(n_sentences))

def count_tokens(text):
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
        f.write(text)
        path = f.name
    try:
        out = subprocess.run([TOK_BIN, "-m", MODEL, "-f", path], capture_output=True, text=True, timeout=600)
        blob = out.stdout + out.stderr
        m = re.search(r"[Tt]otal number of tokens:\s*(\d+)", blob)
        if m:
            return int(m.group(1))
        n = len(re.findall(r"^\s*\d+\s*->", blob, re.M))
        if n > 0:
            return n
    except Exception as e:
        print(f"tokenize failed: {e}", file=sys.stderr)
    finally:
        os.unlink(path)
    return int(len(text) / 3.5)  # fallback estimate

def build_fill(target_tokens):
    # estimate sentences needed, then correct once against real tokenizer count
    probe = make_text(50)
    tpp = count_tokens(probe) / 50.0  # tokens per sentence
    n = max(10, int(target_tokens / tpp))
    text = make_text(n)
    t = count_tokens(text)
    n = max(10, int(n * target_tokens / max(t, 1)))
    text = make_text(n)
    t = count_tokens(text)
    while t > target_tokens and n > 10:
        n = int(n * 0.97)
        text = make_text(n)
        t = count_tokens(text)
    print(f"fill target={target_tokens} actual={t} sentences={n}")
    return text, t

for ctx in (2048, 8192, 16384):
    target = ctx - 384  # headroom for 256 gen + BOS/specials
    text, t = build_fill(target)
    with open(os.path.join(OUT, f"fill_{ctx}.txt"), "w") as f:
        f.write(text)

# ---- needle probe (8k) ----
CODES = [("checkpoint 1", "walnut-42"), ("checkpoint 2", "crimson-17"), ("checkpoint 3", "harbor-88"),
         ("checkpoint 4", "lantern-05"), ("checkpoint 5", "granite-63"), ("checkpoint 6", "meadow-29"),
         ("checkpoint 7", "falcon-74"), ("checkpoint 8", "copper-51"), ("checkpoint 9", "orchid-36"),
         ("checkpoint 10", "thimble-90")]

target = 8192 - 800  # room for question + 400-token answer
text, t = build_fill(target)
words = text.split(" ")
n_needles = len(CODES)
chunks = []
prev = 0
for i, (cp, code) in enumerate(CODES):
    pos = int(len(words) * (0.05 + 0.09 * i))
    chunks.append(" ".join(words[prev:pos]))
    chunks.append(f" Remember this: the secret code for {cp} is {code}. ")
    prev = pos
chunks.append(" ".join(words[prev:]))
haystack = "".join(chunks)

prompt = ("<|im_start|>user\nRead the following document carefully. Hidden inside it are ten secret codes, "
          "one for each checkpoint 1 through 10.\n\nDOCUMENT:\n" + haystack +
          "\n\nNow list all ten secret codes in order, one per line, in the format "
          "'checkpoint N: code'.<|im_end|>\n<|im_start|>assistant\n")
with open(os.path.join(OUT, "needle_8192.txt"), "w") as f:
    f.write(prompt)
with open(os.path.join(OUT, "needle_codes.txt"), "w") as f:
    for cp, code in CODES:
        f.write(f"{cp}|{code}\n")
print(f"needle prompt tokens ~= {count_tokens(prompt)}")
