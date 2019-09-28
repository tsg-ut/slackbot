from tqdm import tqdm
import os
import queue
from collections import defaultdict
import struct
fun = lambda: defaultdict(fun, {"__size": 0})
tree = defaultdict(fun, {"__size": 0})
def append(node, word):
    node["__size"] += 1
    if len(word) == 0:
        node["__$"] = 1
        return
    append(node[word[0]], word[1:])


path = "words.txt"
index = 0
with open(path, "r", encoding="utf-8") as f,\
     tqdm(total=os.path.getsize(path)) as t:
    for line in f:
        append(tree, line.strip())
        t.update(len(bytes(line, "utf-8")))
        index += 1

LBS = [1]
label = []
size = []
terminal = []


q = queue.Queue()
q.put(tree)
with tqdm(total=index) as t:
    while not q.empty():
        n = q.get()
        LBS.append(0)
        if "__$" in n:
            terminal.append(1)
            t.update(1)
        else:
            terminal.append(0)
        size.append(n["__size"])
        for key, child in n.items():
            if len(key) != 1:
                continue
            LBS.append(1)
            label.append(key)
            q.put(child)

print("saving LBS...")
with open("LOUDS_LBS.bin", "wb") as f:
    f.write(bytes(LBS + [0]))

print("saving terminal...")
with open("LOUDS_terminal.bin", "wb") as f:
    f.write(bytes(terminal))

print("saving label...")
with open("LOUDS_label.txt", "w", encoding="utf-8") as f:
    f.write("".join(label))

