from flask import Flask, render_template, jsonify, send_file, request
import shutil
import os

app = Flask(__name__)

# Configura os caminhos da pastas do Active Learning do projeto
CURRENT_CONFIG = {
    "source_dir": "/home/iury/Documents/Challenge 2026 - SPI/Backend-SPI-2026/assets/modelo/active_learning/dataset_captura",
    "target_dir": "/home/iury/Documents/Challenge 2026 - SPI/Backend-SPI-2026/assets/modelo/curated_dataset/dataset_tratado"
}

# Mapeamento de IDs de classes YOLO para nomes amigáveis
CLASS_NAMES = {
    0: "Pessoa",
    1: "Com_luva",
    2: "Com_oculos",
    3: "Com_capacete",
    4: "Com_oculos_normal",
    5: "Com_mascara",
    6: "Sem_luva",
    7: "Sem_oculos",
    8: "Sem_capacete",
    9: "Sem_mascara"
}

def get_source_paths():
    src = CURRENT_CONFIG["source_dir"]
    return os.path.join(src, "images"), os.path.join(src, "labels")

def get_target_paths():
    tgt = CURRENT_CONFIG["target_dir"]
    return os.path.join(tgt, "images"), os.path.join(tgt, "labels")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/config', methods=['GET', 'POST'])
def manage_config():
    """Lê ou atualiza as pastas configuradas dinamicamente."""
    if request.method == 'POST':
        data = request.json or {}
        new_source = data.get("source_dir", "").strip()
        new_target = data.get("target_dir", "").strip()

        if not new_source or not new_target:
            return jsonify({"error": "Os dois diretórios devem ser preenchidos."}), 400

        if not os.path.isdir(new_source):
            return jsonify({"error": f"O diretório de origem não existe: {new_source}"}), 400

        CURRENT_CONFIG["source_dir"] = new_source
        CURRENT_CONFIG["target_dir"] = new_target

        # Garante criação das pastas de destino se não existirem
        tgt_img, tgt_lbl = get_target_paths()
        os.makedirs(tgt_img, exist_ok=True)
        os.makedirs(tgt_lbl, exist_ok=True)

        return jsonify({"status": "sucesso", "config": CURRENT_CONFIG})

    return jsonify(CURRENT_CONFIG)

@app.route('/api/classes', methods=['GET'])
def get_classes():
    return jsonify([{"id": k, "name": v} for k, v in CLASS_NAMES.items()])

@app.route('/api/samples', methods=['GET'])
def list_samples():
    img_dir, lbl_dir = get_source_paths()
    if not os.path.exists(img_dir):
        return jsonify([])

    valid_exts = ('.jpg', '.jpeg', '.png')
    samples = []

    for fname in sorted(os.listdir(img_dir)):
        if fname.lower().endswith(valid_exts):
            base_name = os.path.splitext(fname)[0]
            label_file = f"{base_name}.txt"
            label_path = os.path.join(lbl_dir, label_file)

            if os.path.exists(label_path):
                samples.append({
                    "id": base_name,
                    "image_file": fname,
                    "label_file": label_file
                })
    return jsonify(samples)

@app.route('/api/image/<filename>', methods=['GET'])
def get_image(filename):
    img_dir, _ = get_source_paths()
    filepath = os.path.join(img_dir, filename)
    if not os.path.exists(filepath):
        return "Imagem não encontrada", 404
    return send_file(filepath, mimetype='image/jpeg')

@app.route('/api/labels/<filename>', methods=['GET'])
def get_labels(filename):
    _, lbl_dir = get_source_paths()
    filepath = os.path.join(lbl_dir, filename)
    if not os.path.exists(filepath):
        return jsonify([])

    boxes = []
    with open(filepath, 'r') as f:
        for idx, line in enumerate(f.readlines()):
            parts = line.strip().split()
            if len(parts) == 5:
                cls_id = int(parts[0])
                boxes.append({
                    "box_id": idx,
                    "class_id": cls_id,
                    "class_name": CLASS_NAMES.get(cls_id, f"Classe {cls_id}"),
                    "x_center": float(parts[1]),
                    "y_center": float(parts[2]),
                    "width": float(parts[3]),
                    "height": float(parts[4]),
                    "valid": True
                })
    return jsonify(boxes)

@app.route('/api/save-and-move', methods=['POST'])
def save_and_move():
    dados = request.json or {}
    base_name = dados.get("id")
    image_file = dados.get("image_file")
    label_file = dados.get("label_file")
    boxes = dados.get("boxes", [])

    src_img_dir, src_lbl_dir = get_source_paths()
    tgt_img_dir, tgt_lbl_dir = get_target_paths()

    src_img = os.path.join(src_img_dir, image_file)
    src_lbl = os.path.join(src_lbl_dir, label_file)
    dest_img = os.path.join(tgt_img_dir, image_file)
    dest_lbl = os.path.join(tgt_lbl_dir, label_file)

    lines = []
    for b in boxes:
        if b.get("valid", True):
            cls_id = b["class_id"]
            xc = max(0.0, min(1.0, float(b["x_center"])))
            yc = max(0.0, min(1.0, float(b["y_center"])))
            w = max(0.0, min(1.0, float(b["width"])))
            h = max(0.0, min(1.0, float(b["height"])))
            lines.append(f"{cls_id} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}")

    with open(dest_lbl, 'w') as f:
        f.write("\n".join(lines))

    if os.path.exists(src_img):
        shutil.move(src_img, dest_img)

    if os.path.exists(src_lbl):
        os.remove(src_lbl)

    return jsonify({"status": "sucesso"})

@app.route('/api/sample/<base_name>', methods=['DELETE'])
def delete_sample(base_name):
    src_img_dir, src_lbl_dir = get_source_paths()
    img_path = os.path.join(src_img_dir, f"{base_name}.jpg")
    lbl_path = os.path.join(src_lbl_dir, f"{base_name}.txt")
    if os.path.exists(img_path):
        os.remove(img_path)
    if os.path.exists(lbl_path):
        os.remove(lbl_path)
    return jsonify({"status": "removido"})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)