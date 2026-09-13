from flask import Flask, render_template, jsonify, send_file, request
from augmentation import generate_augmented_copies
import random
import shutil
import yaml
import os
import re

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

CURRENT_CONFIG = {
    "source_dir": os.path.join(BASE_DIR, "active-learning-reviewer/data/captured"),
    "target_dir": os.path.join(BASE_DIR, "active-learning-reviewer/data/cured")
}

CLASS_NAMES = {}

# Memória global para armazenar o timestamp da última imagem processada e o destino da última imagem processada
TIMESTAMP_LAST_IMAGE = None
DEST_LAST_IMAGE = None

def load_config():
    """Carrega a configuração do arquivo YAML, se existir."""
    config_path = os.path.join(BASE_DIR, "config.yaml")

    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            data = yaml.safe_load(f)
            # Configura os caminhos de origem e destino com base no arquivo YAML
            CURRENT_CONFIG["source_dir"] = data.get("path_captured", CURRENT_CONFIG["source_dir"])
            CURRENT_CONFIG["target_dir"] = data.get("path_cured", CURRENT_CONFIG["target_dir"])

            CLASS_NAMES.update(data.get("classes", {}))

def get_source_paths() -> tuple[str, str]:
    src = CURRENT_CONFIG["source_dir"]
    return os.path.join(src, "images"), os.path.join(src, "labels")

def get_target_paths() -> tuple[str, str, str, str]:
    tgt = CURRENT_CONFIG["target_dir"]
    path_train_images = os.path.join(tgt, "train", "images")
    path_train_labels = os.path.join(tgt, "train", "labels")
    path_val_images = os.path.join(tgt, "val", "images")
    path_val_labels = os.path.join(tgt, "val", "labels")

    return path_train_images, path_train_labels, path_val_images, path_val_labels

def extract_timestamp(filename_or_path: str) -> float:
    """Extrai timestamp em segundos do nome do arquivo (ex: frame_al_1789131718074.jpg) ou do mtime."""

    # Primeiro, tenta extrair um número de 10 a 13 dígitos do nome do arquivo
    match = re.search(r'(\d{10,13})', filename_or_path)
    if match:
        val = int(match.group(1)) # Converte para inteiro
        return val / 1000.0 if val > 1e10 else float(val) # Se for timestamp em milissegundos, converte para segundos

    # Se não houver número no nome do arquivo, retorna o mtime do arquivo, se existir
    if os.path.exists(filename_or_path):
        return os.path.getmtime(filename_or_path)

    return 0.0

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

        # Garante a criação das pastas de destino, caso não existam
        tgt_img, tgt_lbl = get_target_paths()
        os.makedirs(tgt_img, exist_ok=True)
        os.makedirs(tgt_lbl, exist_ok=True)

        return jsonify({"status": "sucesso", "config": CURRENT_CONFIG})

    return jsonify(CURRENT_CONFIG)

@app.route('/api/classes', methods=['GET'])
def get_classes():
    return jsonify([{"id": key, "name": value} for key, value in CLASS_NAMES.items()])

@app.route('/api/samples/count', methods=['GET'])
def get_samples_count():
    """Retorna apenas o total de imagens válidas sem carregar tudo na memória."""
    
    img_dir, lbl_dir = get_source_paths()

    if not os.path.exists(img_dir):
        return jsonify({"total": 0})

    valid_exts = ('.jpg', '.jpeg', '.png')
    count = 0

    try:
        for filename in os.scandir(img_dir):

            if filename.is_file() and filename.name.lower().endswith(valid_exts):
                base_name = os.path.splitext(filename.name)[0]
                label_path = os.path.join(lbl_dir, f"{base_name}.txt")

                if os.path.exists(label_path):
                    count += 1

    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify({"total": count})

@app.route('/api/samples', methods=['GET'])
def list_samples():
    """Retorna apenas a fatia solicitada pelo usuário (start e end)."""
    start = request.args.get('start', type=int)
    end = request.args.get('end', type=int)

    if start is None or end is None:
        return jsonify([])

    img_dir, lbl_dir = get_source_paths()
    if not os.path.exists(img_dir):
        return jsonify([])

    valid_exts = ('.jpg', '.jpeg', '.png')

    # Lista e ordena os arquivos de imagem válidos
    all_files = sorted([
        file for file in os.listdir(img_dir)
        if file.lower().endswith(valid_exts)
    ])

    start_idx = max(0, start - 1)
    end_idx = max(start_idx, end)
    sliced_files = all_files[start_idx:end_idx]

    samples = []
    for fname in sliced_files:
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
    """Serve a imagem com cache HTTP ativo de 24 horas para evitar requisições repetidas."""

    img_dir, _ = get_source_paths()
    filepath = os.path.join(img_dir, filename)

    if not os.path.exists(filepath):
        return "Imagem não encontrada", 404

    # max_age=86400 (24h) instrui o navegador a manter em cache local no disco
    return send_file(filepath, mimetype='image/jpeg', max_age=86400)

@app.route('/api/labels/<filename>', methods=['GET'])
def get_labels(filename):
    _, lbl_dir = get_source_paths()
    filepath = os.path.join(lbl_dir, filename)
    if not os.path.exists(filepath):
        return jsonify([])

    boxes = []

    with open(filepath, 'r') as f:
        for idx, line in enumerate(f.readlines()):
            line_str = line.strip()
            if not line_str:
                continue

            conf_val = None

            if ':' in line_str:
                parts_coords, parts_conf = line_str.split(':', 1)
                coords = parts_coords.strip().split()
                try:
                    conf_val = float(parts_conf.strip())
                except ValueError:
                    conf_val = None
            else:
                coords = line_str.split()

            if len(coords) >= 5:
                cls_id = int(coords[0])
                boxes.append({
                    "box_id": idx,
                    "class_id": cls_id,
                    "class_name": CLASS_NAMES.get(cls_id, f"Classe {cls_id}"),
                    "x_center": float(coords[1]),
                    "y_center": float(coords[2]),
                    "width": float(coords[3]),
                    "height": float(coords[4]),
                    "confidence": conf_val,
                    "valid": True
                })
    return jsonify(boxes)

@app.route('/api/save-and-move', methods=['POST'])
def save_and_move():
    global TIMESTAMP_LAST_IMAGE, DEST_LAST_IMAGE

    dados = request.json or {}
    base_name = dados.get("id")
    image_file = dados.get("image_file")
    label_file = dados.get("label_file")
    boxes = dados.get("boxes", [])
    aplicar_augmentation = dados.get("apply_augmentation", False)
    permitir_val_split = dados.get("allow_validation_split", True)
    split = dados.get("split", None)

    # Recebe os diretórios de origem e destino das imagens e labels
    src_img_dir, src_lbl_dir = get_source_paths()
    tgt_train_img_dir, tgt_train_lbl_dir, tgt_val_img_dir, tgt_val_lbl_dir = get_target_paths()

    for path in (tgt_train_img_dir, tgt_train_lbl_dir, tgt_val_img_dir, tgt_val_lbl_dir):
        os.makedirs(path, exist_ok=True)

    src_img: str = os.path.join(src_img_dir, image_file)
    src_lbl: str = os.path.join(src_lbl_dir, label_file)

    # Pega o timestamp do frame atual
    current_timestamp: float = extract_timestamp(src_img)

    if permitir_val_split and split not in ("train", "val"):
        # Determina se a imagem vai para treino ou validação com base no timestamp da última imagem processada
        # Se a diferença for menor que 10 minutos (600 segundos), mantém o mesmo destino da última imagem
        # Se não, decide aleatoriamente com 20% de chance para validação e 80% para treino
        # Isso ajuda a manter a consistência temporal dos dados, evitando que frames consecutivos sejam divididos entre treino e validação.
        # ----> AVISO! <---- 
        # Coloquei para 1 minuto (60 segundos) para teste    
        if (TIMESTAMP_LAST_IMAGE is not None and DEST_LAST_IMAGE is not None and abs(current_timestamp - TIMESTAMP_LAST_IMAGE) < 60):
                split = DEST_LAST_IMAGE
        else:
            split = "val" if random.randint(1, 100) <= 20 else "train"
    else:
        if split not in ("train", "val"):
            split = "train"  # Default para treino se não for validação
        else:
            split = split  # Mantém o valor fornecido pelo usuário


    TIMESTAMP_LAST_IMAGE = current_timestamp
    DEST_LAST_IMAGE = split
    is_val = (split == "val")
    
    # Se não for validação, então vai para treino
    if is_val:
        print(f"🖎 Movendo {image_file} para validação.")
        dest_img = os.path.join(tgt_val_img_dir, image_file)
        dest_lbl = os.path.join(tgt_val_lbl_dir, label_file)
    else:
        dest_img = os.path.join(tgt_train_img_dir, image_file)
        dest_lbl = os.path.join(tgt_train_lbl_dir, label_file)

    # Filtra as caixas válidas confirmadas pelo anotador
    valid_boxes: list = []
    for box in boxes:
        valid_boxes.append(box.get("valid", True))

    # Salva a anotação original na pasta de curadoria
    lines = []
    for box in boxes:
        cls_id = box["class_id"]
        xc = max(0.0, min(1.0, float(box["x_center"])))
        yc = max(0.0, min(1.0, float(box["y_center"])))
        w = max(0.0, min(1.0, float(box["width"])))
        h = max(0.0, min(1.0, float(box["height"])))
        lines.append(f"{int(cls_id)} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}")

    with open(dest_lbl, 'w') as f:
        f.write("\n".join(lines))

    # Move a imagem original para a pasta de curadoria
    if os.path.exists(src_img):
        shutil.move(src_img, dest_img)

    if os.path.exists(src_lbl):
        os.remove(src_lbl)

    # Executa a geração de cópias transformadas se solicitado pelo usuário e não for para validação
    if not is_val and aplicar_augmentation:
        generate_augmented_copies(
            img_path=dest_img, 
            boxes=boxes, 
            dir_output_img=tgt_train_img_dir, 
            dir_output_lbl=tgt_train_lbl_dir, 
            base_name=base_name
        )
    
    return jsonify({"status": "sucesso", "split": split})

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
    load_config()
    app.run(host='0.0.0.0', port=5001, debug=True)