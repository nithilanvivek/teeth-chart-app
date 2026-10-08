import json
import math
import os
import sqlite3
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog

APP_NAME = "ToothChartAnnotator"
DB_FILE = "tooth_chart_annotator.db"

WINDOW_W = 1600
WINDOW_H = 980

UPPER_TOOTH_COUNT = 16
LOWER_TOOTH_COUNT = 16

TOOTH_W = 42
TOOTH_H = 60
SPACE_W = 38
SPACE_H = 22

TOOTH_STATUSES = [
    "permanent",
    "milk",
    "wisdom",
    "empty",
    "not_yet_erupted",
    "fake_tooth",
]

SPACE_STATUSES = [
    "fulfilled",
    "tooth",
    "empty",
]

STATUS_COLORS = {
    "permanent": "white",
    "milk": "skyblue",
    "wisdom": "plum1",
    "empty": "tomato",
    "not_yet_erupted": "khaki1",
    "fake_tooth": "orange",
    "fulfilled": "lightgreen",
    "tooth": "lightcyan",
    "unmarked": "gray85",
}

PERM_UPPER_CODES = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
PERM_LOWER_CODES = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

PRIMARY_UPPER_CODES = [None, None, None, 55, 54, 53, 52, 51, 61, 62, 63, 64, 65, None, None, None]
PRIMARY_LOWER_CODES = [None, None, None, 85, 84, 83, 82, 81, 71, 72, 73, 74, 75, None, None, None]


def get_app_dir() -> str:
    base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    app_dir = os.path.join(base, APP_NAME)
    os.makedirs(app_dir, exist_ok=True)
    return app_dir


def get_db_path() -> str:
    return os.path.join(get_app_dir(), DB_FILE)


def permanent_tooth_name(code: int) -> str:
    quadrant = int(str(code)[0])
    tooth_num = int(str(code)[1])

    arch = "Upper" if quadrant in (1, 2) else "Lower"
    side = "right" if quadrant in (1, 4) else "left"

    names = {
        1: "central incisor",
        2: "lateral incisor",
        3: "canine",
        4: "first premolar",
        5: "second premolar",
        6: "first molar",
        7: "second molar",
        8: "third molar",
    }
    return f"{arch} {side} {names[tooth_num]}"


def primary_tooth_name(code: int) -> str:
    quadrant = int(str(code)[0])
    tooth_num = int(str(code)[1])

    arch = "Upper" if quadrant in (5, 6) else "Lower"
    side = "right" if quadrant in (5, 8) else "left"

    names = {
        1: "central incisor",
        2: "lateral incisor",
        3: "canine",
        4: "first molar",
        5: "second molar",
    }
    return f"{arch} {side} primary {names[tooth_num]}"


class Database:
    def __init__(self, db_path: str):
        self.conn = sqlite3.connect(db_path)
        self.conn.row_factory = sqlite3.Row
        self._create_tables()

    def _create_tables(self):
        cur = self.conn.cursor()

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS chart_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_name TEXT UNIQUE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS chart_annotations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                item_key TEXT NOT NULL,
                item_type TEXT NOT NULL,
                status TEXT NOT NULL,
                wobbly INTEGER NOT NULL DEFAULT 0,
                filled INTEGER NOT NULL DEFAULT 0,
                cavity INTEGER NOT NULL DEFAULT 0,
                painful INTEGER NOT NULL DEFAULT 0,
                note TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(session_id, item_key),
                FOREIGN KEY (session_id) REFERENCES chart_sessions(id) ON DELETE CASCADE
            )
            """
        )

        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS chart_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                edited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                action_label TEXT,
                snapshot_json TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES chart_sessions(id) ON DELETE CASCADE
            )
            """
        )

        for column in [
            "wobbly INTEGER NOT NULL DEFAULT 0",
            "filled INTEGER NOT NULL DEFAULT 0",
            "cavity INTEGER NOT NULL DEFAULT 0",
            "painful INTEGER NOT NULL DEFAULT 0",
        ]:
            try:
                cur.execute(f"ALTER TABLE chart_annotations ADD COLUMN {column}")
            except sqlite3.OperationalError:
                pass

        self.conn.commit()

    def get_or_create_session(self, session_name: str) -> int:
        cur = self.conn.cursor()
        cur.execute(
            "INSERT OR IGNORE INTO chart_sessions (session_name) VALUES (?)",
            (session_name,),
        )
        self.conn.commit()

        cur.execute(
            "SELECT id FROM chart_sessions WHERE session_name = ?",
            (session_name,),
        )
        row = cur.fetchone()
        return int(row["id"])

    def save_annotations(self, session_id: int, annotations: dict):
        cur = self.conn.cursor()
        cur.execute("DELETE FROM chart_annotations WHERE session_id = ?", (session_id,))

        rows = []
        for item_key, item in annotations.items():
            rows.append(
                (
                    session_id,
                    item_key,
                    item["item_type"],
                    item["status"],
                    1 if item.get("wobbly", False) else 0,
                    1 if item.get("filled", False) else 0,
                    1 if item.get("cavity", False) else 0,
                    1 if item.get("painful", False) else 0,
                    item.get("note", ""),
                )
            )

        if rows:
            cur.executemany(
                """
                INSERT INTO chart_annotations (
                    session_id, item_key, item_type, status,
                    wobbly, filled, cavity, painful, note
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )

        self.conn.commit()

    def load_annotations(self, session_id: int) -> dict:
        cur = self.conn.cursor()
        cur.execute(
            """
            SELECT item_key, item_type, status,
                   wobbly, filled, cavity, painful, note
            FROM chart_annotations
            WHERE session_id = ?
            ORDER BY item_key
            """,
            (session_id,),
        )

        result = {}
        for row in cur.fetchall():
            result[row["item_key"]] = {
                "item_type": row["item_type"],
                "status": row["status"],
                "wobbly": bool(row["wobbly"]),
                "filled": bool(row["filled"]),
                "cavity": bool(row["cavity"]),
                "painful": bool(row["painful"]),
                "note": row["note"] or "",
            }
        return result

    def list_sessions(self) -> list[str]:
        cur = self.conn.cursor()
        cur.execute(
            "SELECT session_name FROM chart_sessions ORDER BY session_name COLLATE NOCASE"
        )
        return [row["session_name"] for row in cur.fetchall()]

    def add_history_entry(self, session_id: int, annotations: dict, action_label: str):
        cur = self.conn.cursor()
        snapshot_json = json.dumps(annotations, ensure_ascii=False, sort_keys=True)
        cur.execute(
            """
            INSERT INTO chart_history (session_id, action_label, snapshot_json)
            VALUES (?, ?, ?)
            """,
            (session_id, action_label, snapshot_json),
        )
        self.conn.commit()

    def get_history_entries(self, session_id: int) -> list[dict]:
        cur = self.conn.cursor()
        cur.execute(
            """
            SELECT id, edited_at, action_label, snapshot_json
            FROM chart_history
            WHERE session_id = ?
            ORDER BY id DESC
            """,
            (session_id,),
        )
        return [dict(row) for row in cur.fetchall()]

    def load_history_snapshot(self, history_id: int) -> dict:
        cur = self.conn.cursor()
        cur.execute(
            "SELECT snapshot_json FROM chart_history WHERE id = ?",
            (history_id,),
        )
        row = cur.fetchone()
        if not row:
            return {}
        try:
            data = json.loads(row["snapshot_json"])
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}
class ToothChartApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Tooth Chart Annotator - AutoSave")
        self.root.geometry(f"{WINDOW_W}x{WINDOW_H}")

        self.db = Database(get_db_path())

        self.selected_item_type = tk.StringVar(value="tooth")
        self.selected_tooth_status = tk.StringVar(value="permanent")
        self.selected_space_status = tk.StringVar(value="fulfilled")

        self.wobbly_var = tk.BooleanVar(value=False)
        self.filled_var = tk.BooleanVar(value=False)
        self.cavity_var = tk.BooleanVar(value=False)
        self.painful_var = tk.BooleanVar(value=False)

        self.session_name_var = tk.StringVar(value="default_chart")

        self.current_session_id = self.db.get_or_create_session(
            self.session_name_var.get()
        )

        self.annotations = self.db.load_annotations(self.current_session_id)

        self.item_geometry = {}

        self.hovered_key = None
        self.tooltip = None
        self.tooltip_label = None

        self.valid_tooth_keys = {
            f"upper_tooth_{i}" for i in range(1, UPPER_TOOTH_COUNT + 1)
        }
        self.valid_tooth_keys |= {
            f"lower_tooth_{i}" for i in range(1, LOWER_TOOTH_COUNT + 1)
        }

        self.valid_space_keys = {
            f"upper_space_{i}" for i in range(1, UPPER_TOOTH_COUNT + 1)
        }
        self.valid_space_keys |= {
            f"lower_space_{i}" for i in range(1, LOWER_TOOTH_COUNT + 1)
        }

        self._build_ui()
        self._draw_chart()

    def _build_ui(self):
        main = tk.Frame(self.root)
        main.pack(fill=tk.BOTH, expand=True)

        left = tk.Frame(main, padx=10, pady=10)
        left.pack(side=tk.LEFT, fill=tk.Y)

        right = tk.Frame(main, padx=10, pady=10)
        right.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True)

        tk.Label(
            left,
            text="Chart name",
            font=("Arial", 12, "bold"),
        ).pack(anchor="w")

        tk.Entry(
            left,
            textvariable=self.session_name_var,
            width=26,
        ).pack(anchor="w", pady=(0, 6))

        tk.Button(
            left,
            text="Use / Create Chart",
            width=24,
            command=self.use_chart,
        ).pack(anchor="w", pady=(0, 8))

        tk.Button(
            left,
            text="Load Existing Chart",
            width=24,
            command=self.choose_chart,
        ).pack(anchor="w", pady=(0, 14))

        tk.Label(
            left,
            text="What are you marking?",
            font=("Arial", 12, "bold"),
        ).pack(anchor="w")

        tk.Radiobutton(
            left,
            text="Tooth",
            variable=self.selected_item_type,
            value="tooth",
            command=self._refresh_mode_ui,
        ).pack(anchor="w")

        tk.Radiobutton(
            left,
            text="Gum space",
            variable=self.selected_item_type,
            value="space",
            command=self._refresh_mode_ui,
        ).pack(anchor="w")

        self.tooth_frame = tk.LabelFrame(
            left,
            text="Tooth options",
            padx=6,
            pady=6,
        )
        self.tooth_frame.pack(fill=tk.X, pady=(12, 8))

        for status in TOOTH_STATUSES:
            row = tk.Frame(self.tooth_frame)
            row.pack(anchor="w", pady=1)

            tk.Label(
                row,
                width=2,
                height=1,
                bg=STATUS_COLORS.get(status, "gray"),
                relief="solid",
                bd=1,
            ).pack(side=tk.LEFT, padx=(0, 6))

            tk.Radiobutton(
                row,
                text=status.replace("_", " ").title(),
                variable=self.selected_tooth_status,
                value=status,
            ).pack(side=tk.LEFT)

        tk.Checkbutton(
            self.tooth_frame,
            text="Wobbly tooth",
            variable=self.wobbly_var,
        ).pack(anchor="w", pady=(6, 0))

        tk.Checkbutton(
            self.tooth_frame,
            text="Filled",
            variable=self.filled_var,
        ).pack(anchor="w")

        tk.Checkbutton(
            self.tooth_frame,
            text="Cavity",
            variable=self.cavity_var,
        ).pack(anchor="w")

        tk.Checkbutton(
            self.tooth_frame,
            text="Painful / Sensitive",
            variable=self.painful_var,
        ).pack(anchor="w")

        self.space_frame = tk.LabelFrame(
            left,
            text="Gum space options",
            padx=6,
            pady=6,
        )

        self.space_frame.pack(fill=tk.X, pady=(8, 12))

        for status in SPACE_STATUSES:
            row = tk.Frame(self.space_frame)
            row.pack(anchor="w", pady=1)

            tk.Label(
                row,
                width=2,
                height=1,
                bg=STATUS_COLORS.get(status, "gray"),
                relief="solid",
                bd=1,
            ).pack(side=tk.LEFT, padx=(0, 6))

            tk.Radiobutton(
                row,
                text=status.title(),
                variable=self.selected_space_status,
                value=status,
            ).pack(side=tk.LEFT)

        tk.Label(
            left,
            text="Actions",
            font=("Arial", 12, "bold"),
        ).pack(anchor="w")

        tk.Button(
            left,
            text="Load",
            width=24,
            command=self.load_annotations,
        ).pack(anchor="w", pady=3)

        tk.Button(
            left,
            text="View History",
            width=24,
            command=self.show_history_window,
        ).pack(anchor="w", pady=3)

        tk.Button(
            left,
            text="Import JSON",
            width=24,
            command=self.import_json,
        ).pack(anchor="w", pady=3)

        tk.Button(
            left,
            text="Clear Current Chart",
            width=24,
            command=self.clear_annotations,
        ).pack(anchor="w", pady=3)

        tk.Button(
            left,
            text="Export JSON",
            width=24,
            command=self.export_json,
        ).pack(anchor="w", pady=3)

        self.status_var = tk.StringVar(
            value="Ready. Auto-save is ON."
        )

        tk.Label(
            left,
            textvariable=self.status_var,
            fg="blue",
            wraplength=280,
            justify=tk.LEFT,
        ).pack(anchor="w", pady=(12, 0))

        self.canvas = tk.Canvas(
            right,
            bg="gray20",
        )

        self.canvas.pack(fill=tk.BOTH, expand=True)

        self.canvas.bind("<Button-1>", self.on_left_click)
        self.canvas.bind("<Button-3>", self.on_right_click)
        self.canvas.bind("<Motion>", self.on_mouse_move)
        self.canvas.bind("<Leave>", self.on_mouse_leave)

        self._refresh_mode_ui()
    def _refresh_mode_ui(self):
        mode = self.selected_item_type.get()
        if mode == "tooth":
            self._set_children_state(self.tooth_frame, "normal")
            self._set_children_state(self.space_frame, "disabled")
        else:
            self._set_children_state(self.tooth_frame, "disabled")
            self._set_children_state(self.space_frame, "normal")

    def _set_children_state(self, widget, state: str):
        for child in widget.winfo_children():
            try:
                child.configure(state=state)
            except Exception:
                pass

    def autosave(self, action_label: str = "Edited chart"):
        if self.current_session_id:
            self.db.save_annotations(self.current_session_id, self.annotations)
            self.db.add_history_entry(self.current_session_id, self.annotations, action_label)

    def get_change_description(self, item_key, old_ann, new_ann):
        label = self.item_geometry[item_key]["label"]

        if old_ann is None and new_ann is not None:
            text = f"{label}: added ({new_ann['status'].replace('_', ' ').title()})"
            for key, word in [
                ("wobbly", "Wobbly"),
                ("filled", "Filled"),
                ("cavity", "Cavity"),
                ("painful", "Painful/Sensitive"),
            ]:
                if new_ann.get(key):
                    text += f" (+{word})"
            return text

        if old_ann is not None and new_ann is None:
            return f"{label}: removed"

        text = (
            f"{label}: {old_ann['status'].replace('_', ' ').title()} "
            f"→ {new_ann['status'].replace('_', ' ').title()}"
        )

        for key, word in [
            ("wobbly", "Wobbly"),
            ("filled", "Filled"),
            ("cavity", "Cavity"),
            ("painful", "Painful/Sensitive"),
        ]:
            old_val = old_ann.get(key, False)
            new_val = new_ann.get(key, False)
            if old_val != new_val:
                text += f" (+{word})" if new_val else f" (-{word})"

        old_note = (old_ann.get("note", "") or "").strip()
        new_note = (new_ann.get("note", "") or "").strip()

        if old_note != new_note:
            if old_note and new_note:
                text += " (note changed)"
            elif new_note:
                text += " (note added)"
            else:
                text += " (note removed)"

        return text

    def use_chart(self):
        name = self.session_name_var.get().strip()
        if not name:
            messagebox.showwarning("Chart name required", "Enter a chart name first.")
            return

        self.current_session_id = self.db.get_or_create_session(name)
        self.annotations = self.db.load_annotations(self.current_session_id)
        self._draw_chart()
        self.status_var.set(f"Using chart: {name}. Auto-save is ON.")

    def choose_chart(self):
        sessions = self.db.list_sessions()
        if not sessions:
            messagebox.showinfo("No saved charts", "No saved charts found yet.")
            return

        top = tk.Toplevel(self.root)
        top.title("Choose chart")
        top.geometry("320x320")
        top.transient(self.root)
        top.grab_set()

        tk.Label(top, text="Select a saved chart", font=("Arial", 12, "bold")).pack(pady=10)

        listbox = tk.Listbox(top)
        listbox.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        for name in sessions:
            listbox.insert(tk.END, name)

        def load_selected():
            sel = listbox.curselection()
            if not sel:
                return

            name = listbox.get(sel[0])
            self.session_name_var.set(name)
            self.current_session_id = self.db.get_or_create_session(name)
            self.annotations = self.db.load_annotations(self.current_session_id)
            self._draw_chart()
            self.status_var.set(f"Loaded chart: {name}. Auto-save is ON.")
            top.destroy()

        tk.Button(top, text="Load", command=load_selected).pack(pady=10)

    def _upper_center(self):
        return 620, 285

    def _lower_center(self):
        return 620, 600

    def _upper_tooth_center(self, index):
        cx, cy = self._upper_center()
        rx = 500
        ry = 150
        start_deg = 200
        end_deg = 340
        angle_deg = start_deg + (end_deg - start_deg) * (index / (UPPER_TOOTH_COUNT - 1))
        angle = math.radians(angle_deg)
        return cx + rx * math.cos(angle), cy + ry * math.sin(angle)

    def _upper_space_center(self, index):
        cx, cy = self._upper_center()
        rx = 500
        ry = 220
        start_deg = 200
        end_deg = 340
        angle_deg = start_deg + (end_deg - start_deg) * (index / (UPPER_TOOTH_COUNT - 1))
        angle = math.radians(angle_deg)
        return cx + rx * math.cos(angle), cy + ry * math.sin(angle)

    def _lower_tooth_center(self, index):
        cx, cy = self._lower_center()
        rx = 500
        ry = 150
        start_deg = 20
        end_deg = 160
        angle_deg = start_deg + (end_deg - start_deg) * (index / (LOWER_TOOTH_COUNT - 1))
        angle = math.radians(angle_deg)
        return cx + rx * math.cos(angle), cy + ry * math.sin(angle)

    def _lower_space_center(self, index):
        cx, cy = self._lower_center()
        rx = 500
        ry = 220
        start_deg = 20
        end_deg = 160
        angle_deg = start_deg + (end_deg - start_deg) * (index / (LOWER_TOOTH_COUNT - 1))
        angle = math.radians(angle_deg)
        return cx + rx * math.cos(angle), cy + ry * math.sin(angle)

    def get_fdi_info(self, item_key: str):
        parts = item_key.split("_")
        if len(parts) != 3:
            return None

        arch = parts[0]
        position = int(parts[2]) - 1

        if arch == "upper":
            perm_code = PERM_UPPER_CODES[position]
            primary_code = PRIMARY_UPPER_CODES[position]
            gum_word = "above"
        else:
            perm_code = PERM_LOWER_CODES[position]
            primary_code = PRIMARY_LOWER_CODES[position]
            gum_word = "below"

        return {
            "perm_code": perm_code,
            "perm_name": permanent_tooth_name(perm_code),
            "primary_code": primary_code,
            "primary_name": primary_tooth_name(primary_code) if primary_code else None,
            "gum_word": gum_word,
        }

    def _draw_chart(self):
        self.canvas.delete("all")
        self.item_geometry.clear()

        self.canvas.create_text(120, 430, anchor="w", fill="white", font=("Arial", 14, "bold"), text="Left")
        self.canvas.create_text(1120, 430, anchor="w", fill="white", font=("Arial", 14, "bold"), text="Right")
        self.canvas.create_text(80, 40, anchor="w", fill="white", font=("Arial", 16, "bold"), text="Upper jaw")
        self.canvas.create_text(80, 515, anchor="w", fill="white", font=("Arial", 16, "bold"), text="Lower jaw")
        self.canvas.create_text(80, 72, anchor="w", fill="gray80", font=("Arial", 10), text="Rectangles = gum spaces, Ovals = teeth")

        for i in range(UPPER_TOOTH_COUNT):
            tx, ty = self._upper_tooth_center(i)
            sx, sy = self._upper_space_center(i)

            self.item_geometry[f"upper_tooth_{i+1}"] = {
                "x1": tx - TOOTH_W / 2,
                "y1": ty - TOOTH_H / 2,
                "x2": tx + TOOTH_W / 2,
                "y2": ty + TOOTH_H / 2,
                "item_type": "tooth",
                "label": f"U{i+1}",
            }

            self.item_geometry[f"upper_space_{i+1}"] = {
                "x1": sx - SPACE_W / 2,
                "y1": sy - SPACE_H / 2,
                "x2": sx + SPACE_W / 2,
                "y2": sy + SPACE_H / 2,
                "item_type": "space",
                "label": f"UG{i+1}",
            }

        for i in range(LOWER_TOOTH_COUNT):
            tx, ty = self._lower_tooth_center(i)
            sx, sy = self._lower_space_center(i)

            self.item_geometry[f"lower_tooth_{i+1}"] = {
                "x1": tx - TOOTH_W / 2,
                "y1": ty - TOOTH_H / 2,
                "x2": tx + TOOTH_W / 2,
                "y2": ty + TOOTH_H / 2,
                "item_type": "tooth",
                "label": f"L{i+1}",
            }

            self.item_geometry[f"lower_space_{i+1}"] = {
                "x1": sx - SPACE_W / 2,
                "y1": sy - SPACE_H / 2,
                "x2": sx + SPACE_W / 2,
                "y2": sy + SPACE_H / 2,
                "item_type": "space",
                "label": f"LG{i+1}",
            }

        for key, geom in self.item_geometry.items():
            ann = self.annotations.get(key)
            status = ann["status"] if ann else "unmarked"
            fill = STATUS_COLORS.get(status, "gray85")

            outline = "gold" if key == self.hovered_key else "black"
            width = 4 if key == self.hovered_key else 2

            if geom["item_type"] == "space":
                self.canvas.create_rectangle(
                    geom["x1"], geom["y1"], geom["x2"], geom["y2"],
                    fill=fill, outline=outline, width=width
                )
            else:
                self.canvas.create_oval(
                    geom["x1"], geom["y1"], geom["x2"], geom["y2"],
                    fill=fill, outline=outline, width=width
                )

            label_text = geom["label"]
            if ann:
                short = self.get_short_status_text(ann["status"])
                markers = []
                if ann.get("wobbly"):
                    markers.append("W")
                if ann.get("filled"):
                    markers.append("F")
                if ann.get("cavity"):
                    markers.append("C")
                if ann.get("painful"):
                    markers.append("PoS")
                if markers:
                    short = f"{short} + {'/'.join(markers)}"
                label_text = f"{geom['label']}\n{short}"

            self.canvas.create_text(
                (geom["x1"] + geom["x2"]) / 2,
                (geom["y1"] + geom["y2"]) / 2,
                text=label_text,
                font=("Arial", 9, "bold"),
                fill="black",
                justify="center",
            )

    def get_short_status_text(self, status: str) -> str:
        mapping = {
            "permanent": "P",
            "milk": "M",
            "wisdom": "W",
            "empty": "E",
            "not_yet_erupted": "NYE",
            "fake_tooth": "FT",
            "fulfilled": "F",
            "tooth": "T",
        }
        return mapping.get(status, status[:1].upper())

    def _find_item_at(self, x, y):
        candidates = []

        for key, geom in self.item_geometry.items():
            cx = (geom["x1"] + geom["x2"]) / 2
            cy = (geom["y1"] + geom["y2"]) / 2

            if geom["item_type"] == "space":
                hit_w = max((geom["x2"] - geom["x1"]) / 2, 36)
                hit_h = max((geom["y2"] - geom["y1"]) / 2, 24)
            else:
                hit_w = max((geom["x2"] - geom["x1"]) / 2, 26)
                hit_h = max((geom["y2"] - geom["y1"]) / 2, 30)

            dx = abs(x - cx)
            dy = abs(y - cy)

            if dx <= hit_w and dy <= hit_h:
                dist2 = (x - cx) ** 2 + (y - cy) ** 2
                priority = 0 if geom["item_type"] == "space" else 1
                candidates.append((priority, dist2, key))

        if not candidates:
            return None

        candidates.sort()
        return candidates[0][2]

    def on_left_click(self, event):
        item_key = self._find_item_at(event.x, event.y)
        if not item_key:
            return

        geom = self.item_geometry[item_key]
        selected_mode = self.selected_item_type.get()

        if geom["item_type"] != selected_mode:
            self.status_var.set(
                f"That item is a {geom['item_type']}. Switch the selection on the left first."
            )
            return

        old_ann = self.annotations.get(item_key)

        existing_note = ""
        if old_ann:
            existing_note = old_ann.get("note", "")

        note = simpledialog.askstring(
            "Add note",
            f"Enter note for {geom['label']} (leave blank for no note):",
            initialvalue=existing_note,
            parent=self.root,
        )

        if selected_mode == "tooth":
            status = self.selected_tooth_status.get()
            wobbly = bool(self.wobbly_var.get())
            filled = bool(self.filled_var.get())
            cavity = bool(self.cavity_var.get())
            painful = bool(self.painful_var.get())
        else:
            status = self.selected_space_status.get()
            wobbly = False
            filled = False
            cavity = False
            painful = False

        new_ann = {
            "item_type": geom["item_type"],
            "status": status,
            "wobbly": wobbly,
            "filled": filled,
            "cavity": cavity,
            "painful": painful,
            "note": (note or "").strip(),
        }

        self.annotations[item_key] = new_ann
        change_text = self.get_change_description(item_key, old_ann, new_ann)

        self.autosave(change_text)
        self._draw_chart()
        self.status_var.set(f"{change_text}. Auto-saved.")

    def on_right_click(self, event):
        item_key = self._find_item_at(event.x, event.y)
        if not item_key:
            return

        if item_key in self.annotations:
            old_ann = self.annotations[item_key]
            change_text = self.get_change_description(item_key, old_ann, None)

            del self.annotations[item_key]

            self.autosave(change_text)
            self._draw_chart()
            self.status_var.set(f"{change_text}. Auto-saved.")

    def on_mouse_move(self, event):
        item_key = self._find_item_at(event.x, event.y)

        if item_key != self.hovered_key:
            self.hovered_key = item_key
            self._draw_chart()

        if item_key:
            self.show_tooltip(event.x_root, event.y_root, item_key)
        else:
            self.hide_tooltip()

    def on_mouse_leave(self, _event):
        self.hovered_key = None
        self.hide_tooltip()
        self._draw_chart()

    def show_tooltip(self, x_root, y_root, item_key):
        geom = self.item_geometry.get(item_key)
        if not geom:
            self.hide_tooltip()
            return

        ann = self.annotations.get(item_key)
        info = self.get_fdi_info(item_key)

        lines = [geom["label"]]

        if ann:
            lines.append(f"Status: {ann['status'].replace('_', ' ').title()}")

            if ann.get("wobbly"):
                lines.append("Wobbly")
            if ann.get("filled"):
                lines.append("Filled")
            if ann.get("cavity"):
                lines.append("Cavity")
            if ann.get("painful"):
                lines.append("Painful / Sensitive")

            note = ann.get("note", "").strip()
            if note:
                lines.append(f"Note: {note}")
        else:
            lines.append("Status: Unmarked")

        if info:
            if geom["item_type"] == "tooth":
                lines.append(f"FDI permanent: {info['perm_code']} - {info['perm_name']}")
                if info["primary_code"] is not None:
                    lines.append(f"FDI milk: {info['primary_code']} - {info['primary_name']}")
            else:
                lines.append(f"Gum space {info['gum_word']} permanent tooth {info['perm_code']}")
                if info["primary_code"] is not None:
                    lines.append(f"Gum space {info['gum_word']} milk tooth {info['primary_code']}")

        text = "\n".join(lines)

        if self.tooltip is None:
            self.tooltip = tk.Toplevel(self.root)
            self.tooltip.wm_overrideredirect(True)
            self.tooltip.attributes("-topmost", True)

            self.tooltip_label = tk.Label(
                self.tooltip,
                text=text,
                justify=tk.LEFT,
                bg="lightyellow",
                relief="solid",
                bd=1,
                font=("Arial", 9),
                padx=6,
                pady=4,
            )
            self.tooltip_label.pack()
        else:
            self.tooltip_label.config(text=text)

        self.tooltip.geometry(f"+{x_root + 14}+{y_root + 14}")

    def hide_tooltip(self):
        if self.tooltip is not None:
            self.tooltip.destroy()
            self.tooltip = None
            self.tooltip_label = None

    def load_annotations(self):
        if not self.current_session_id:
            messagebox.showwarning("No chart", "Create or choose a chart first.")
            return

        self.annotations = self.db.load_annotations(self.current_session_id)
        self._draw_chart()
        self.status_var.set(f"Loaded {len(self.annotations)} marked item(s).")

    def clear_annotations(self):
        if messagebox.askyesno("Clear current chart", "Remove all markings from the current chart?"):
            self.annotations = {}
            self.autosave("Cleared current chart")
            self._draw_chart()
            self.status_var.set("Cleared current chart. Auto-saved.")

    def export_json(self):
        save_path = filedialog.asksaveasfilename(
            title="Export chart as JSON",
            defaultextension=".json",
            filetypes=[("JSON files", "*.json")],
        )
        if not save_path:
            return

        payload = {
            "chart_name": self.session_name_var.get().strip(),
            "annotations": self.annotations,
        }

        try:
            with open(save_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
        except Exception as exc:
            messagebox.showerror("Export failed", str(exc))
            return

        self.status_var.set(f"Exported JSON to {save_path}")

    def import_json(self):
        file_path = filedialog.askopenfilename(
            title="Import chart from JSON",
            filetypes=[("JSON files", "*.json")],
        )
        if not file_path:
            return

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                payload = json.load(f)
        except Exception as exc:
            messagebox.showerror("Import failed", f"Could not read JSON file.\n\n{exc}")
            return

        if not isinstance(payload, dict):
            messagebox.showerror("Import failed", "JSON file format is invalid.")
            return

        imported_annotations = payload.get("annotations")
        if not isinstance(imported_annotations, dict):
            messagebox.showerror("Import failed", "JSON does not contain a valid 'annotations' object.")
            return

        current_chart_name = self.session_name_var.get().strip()
        if not current_chart_name:
            messagebox.showwarning(
                "Chart name required",
                "Type a chart name in the box first. The imported data will be saved into that chart."
            )
            return

        cleaned_annotations = {}

        for item_key, item in imported_annotations.items():
            if not isinstance(item, dict):
                continue

            item_type = item.get("item_type")
            status = item.get("status")
            note = item.get("note", "")
            wobbly = bool(item.get("wobbly", False))
            filled = bool(item.get("filled", False))
            cavity = bool(item.get("cavity", False))
            painful = bool(item.get("painful", False))

            if item_key in self.valid_tooth_keys:
                if item_type != "tooth":
                    continue
                if status not in TOOTH_STATUSES:
                    continue
            elif item_key in self.valid_space_keys:
                if item_type != "space":
                    continue
                if status not in SPACE_STATUSES:
                    continue
                wobbly = False
                filled = False
                cavity = False
                painful = False
            else:
                continue

            cleaned_annotations[item_key] = {
                "item_type": item_type,
                "status": status,
                "wobbly": wobbly,
                "filled": filled,
                "cavity": cavity,
                "painful": painful,
                "note": str(note) if note is not None else "",
            }

        self.current_session_id = self.db.get_or_create_session(current_chart_name)
        self.annotations = cleaned_annotations
        self.autosave("Imported chart from JSON")
        self._draw_chart()

        self.status_var.set(
            f"Imported {len(cleaned_annotations)} item(s) into chart '{current_chart_name}'."
        )
        messagebox.showinfo(
            "Import complete",
            f"Chart imported and saved locally into '{current_chart_name}'."
        )

    def show_history_window(self):
        if not self.current_session_id:
            messagebox.showwarning("No chart", "Create or choose a chart first.")
            return

        entries = self.db.get_history_entries(self.current_session_id)

        top = tk.Toplevel(self.root)
        top.title(f"History - {self.session_name_var.get().strip()}")
        top.geometry("900x480")
        top.transient(self.root)

        tk.Label(
            top,
            text=f"Edit history for chart: {self.session_name_var.get().strip()}",
            font=("Arial", 12, "bold"),
        ).pack(pady=10)

        listbox = tk.Listbox(top, width=120, height=18)
        listbox.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        history_ids = []

        if not entries:
            listbox.insert(tk.END, "No history entries yet.")
            listbox.config(state=tk.DISABLED)
        else:
            for entry in entries:
                edited_at = entry["edited_at"]
                action_label = entry["action_label"] or "Edited chart"

                snapshot = {}
                try:
                    snapshot = json.loads(entry["snapshot_json"])
                except json.JSONDecodeError:
                    snapshot = {}

                item_count = len(snapshot) if isinstance(snapshot, dict) else 0
                row_text = f"{edited_at}  |  {action_label}  |  {item_count} marked item(s)"
                listbox.insert(tk.END, row_text)
                history_ids.append(entry["id"])

        button_row = tk.Frame(top)
        button_row.pack(pady=(0, 12))

        def preview_selected():
            if not history_ids:
                return

            sel = listbox.curselection()
            if not sel:
                return

            history_id = history_ids[sel[0]]
            snapshot = self.db.load_history_snapshot(history_id)
            self.annotations = snapshot
            self._draw_chart()
            self.status_var.set("Previewed selected history snapshot.")

        def restore_selected():
            if not history_ids:
                return

            sel = listbox.curselection()
            if not sel:
                return

            history_id = history_ids[sel[0]]
            snapshot = self.db.load_history_snapshot(history_id)

            if not isinstance(snapshot, dict):
                messagebox.showerror("Restore failed", "Could not read that history snapshot.")
                return

            self.annotations = snapshot
            self.autosave("Restored from history")
            self._draw_chart()
            self.status_var.set("Restored selected history snapshot.")
            messagebox.showinfo("History restored", "That history version is now the current chart.")

        tk.Button(
            button_row,
            text="Preview Selected",
            width=18,
            command=preview_selected,
        ).pack(side=tk.LEFT, padx=6)

        tk.Button(
            button_row,
            text="Restore Selected",
            width=18,
            command=restore_selected,
        ).pack(side=tk.LEFT, padx=6)

        tk.Button(
            button_row,
            text="Close",
            width=12,
            command=top.destroy,
        ).pack(side=tk.LEFT, padx=6)


def main():
    root = tk.Tk()
    ToothChartApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
