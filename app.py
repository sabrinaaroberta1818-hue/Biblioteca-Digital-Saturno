from flask import Flask, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
import sqlite3
import os
import uuid
from contextlib import contextmanager

# =========================================================
# 1. CONFIGURAÇÃO DO PROJETO
# =========================================================
app = Flask(__name__)
BASE = os.path.dirname(os.path.abspath(__file__))
UPLOAD_FOLDER = os.path.join(BASE, "uploads")
DB = os.path.join(BASE, "biblioteca.db")
app.config["MAX_CONTENT_LENGTH"] = 85 * 1024 * 1024
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

EXTENSOES_LIVRO = {"pdf", "epub"}
EXTENSOES_IMAGEM = {"png", "jpg", "jpeg", "webp", "gif"}


# =========================================================
# 2. BANCO DE DADOS SQLITE
# =========================================================
@contextmanager
def conectar():
    """Abre, confirma (ou desfaz) e sempre fecha a conexão SQLite."""
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def iniciar_banco():
    with conectar() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS categorias (
                id TEXT PRIMARY KEY,
                nome TEXT NOT NULL UNIQUE
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS livros (
                id TEXT PRIMARY KEY,
                titulo TEXT NOT NULL,
                autor TEXT DEFAULT '',
                ano INTEGER,
                descricao TEXT DEFAULT '',
                categoria_id TEXT,
                arquivo TEXT,
                capa TEXT,
                favorito INTEGER DEFAULT 0,
                status TEXT DEFAULT '',
                criado_em INTEGER,
                FOREIGN KEY (categoria_id) REFERENCES categorias(id)
                    ON DELETE SET NULL
            )
        """)
        # Compatibilidade com a tabela criada pela versão anterior.
        colunas = {coluna["name"] for coluna in conn.execute(
            "PRAGMA table_info(livros)"
        ).fetchall()}
        if "criado_em" not in colunas:
            conn.execute("ALTER TABLE livros ADD COLUMN criado_em INTEGER")


# =========================================================
# 3. FUNÇÕES AUXILIARES
# =========================================================
def resposta_erro(mensagem, codigo=400):
    return jsonify({"erro": mensagem}), codigo


def salvar_upload(campo, id_livro, tipo):
    arquivo = request.files.get(campo)
    if not arquivo or not arquivo.filename:
        return None

    nome_seguro = secure_filename(arquivo.filename)
    extensao = nome_seguro.rsplit(".", 1)[-1].lower() if "." in nome_seguro else ""
    permitidas = EXTENSOES_LIVRO if tipo == "livro" else EXTENSOES_IMAGEM
    if extensao not in permitidas:
        raise ValueError("Formato de arquivo não permitido.")

    nome = f"{id_livro}_{tipo}_{uuid.uuid4().hex[:8]}.{extensao}"
    arquivo.save(os.path.join(UPLOAD_FOLDER, nome))
    return nome


def apagar_upload(nome):
    if nome:
        caminho = os.path.join(UPLOAD_FOLDER, nome)
        if os.path.isfile(caminho):
            os.remove(caminho)


def livro_existe(conn, id_livro):
    return conn.execute(
        "SELECT * FROM livros WHERE id = ?", (id_livro,)
    ).fetchone()


# =========================================================
# 4. ENTREGA DO FRONT-END E ARQUIVOS ENVIADOS
# =========================================================
@app.route("/")
def inicio():
    return send_from_directory(BASE, "index.html")


@app.route("/css/<path:arquivo>")
def css(arquivo):
    return send_from_directory(os.path.join(BASE, "css"), arquivo)


@app.route("/js/<path:arquivo>")
def javascript(arquivo):
    return send_from_directory(os.path.join(BASE, "js"), arquivo)


@app.route("/uploads/<path:arquivo>")
def uploads(arquivo):
    return send_from_directory(UPLOAD_FOLDER, arquivo)


# =========================================================
# 5. ROTAS DE LIVROS
# =========================================================
@app.route("/api/livros", methods=["GET"])
def listar_livros():
    with conectar() as conn:
        livros = conn.execute(
            "SELECT * FROM livros ORDER BY criado_em DESC"
        ).fetchall()
    return jsonify([dict(livro) for livro in livros])


@app.route("/api/livros", methods=["POST"])
def cadastrar_livro():
    titulo = request.form.get("titulo", "").strip()
    if not titulo:
        return resposta_erro("O título é obrigatório.")

    id_livro = str(uuid.uuid4())
    nome_arquivo = nome_capa = None
    try:
        nome_arquivo = salvar_upload("arquivo", id_livro, "livro")
        nome_capa = salvar_upload("capa", id_livro, "capa")
        ano = request.form.get("ano") or None
        with conectar() as conn:
            conn.execute("""
                INSERT INTO livros
                (id, titulo, autor, ano, descricao, categoria_id,
                 arquivo, capa, criado_em)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%s','now'))
            """, (
                id_livro, titulo, request.form.get("autor", "").strip(),
                ano, request.form.get("descricao", "").strip(),
                request.form.get("categoria_id") or None,
                nome_arquivo, nome_capa
            ))
        return jsonify({"mensagem": "Livro cadastrado.", "id": id_livro}), 201
    except ValueError as erro:
        apagar_upload(nome_arquivo)
        apagar_upload(nome_capa)
        return resposta_erro(str(erro))
    except sqlite3.IntegrityError:
        apagar_upload(nome_arquivo)
        apagar_upload(nome_capa)
        return resposta_erro("A categoria informada não existe.")


@app.route("/api/livros/<id_livro>", methods=["PUT"])
def editar_livro(id_livro):
    novos_arquivos = []
    with conectar() as conn:
        livro = livro_existe(conn, id_livro)
        if not livro:
            return resposta_erro("Livro não encontrado.", 404)

        try:
            nome_arquivo = salvar_upload("arquivo", id_livro, "livro") or livro["arquivo"]
            nome_capa = salvar_upload("capa", id_livro, "capa") or livro["capa"]
            if nome_arquivo != livro["arquivo"] and nome_arquivo:
                novos_arquivos.append(nome_arquivo)
            if nome_capa != livro["capa"] and nome_capa:
                novos_arquivos.append(nome_capa)

            titulo = request.form.get("titulo", livro["titulo"]).strip()
            if not titulo:
                return resposta_erro("O título é obrigatório.")
            conn.execute("""
                UPDATE livros SET titulo = ?, autor = ?, ano = ?, descricao = ?,
                    categoria_id = ?, arquivo = ?, capa = ?
                WHERE id = ?
            """, (
                titulo, request.form.get("autor", livro["autor"]).strip(),
                request.form.get("ano") or None,
                request.form.get("descricao", livro["descricao"]).strip(),
                request.form.get("categoria_id") or None,
                nome_arquivo, nome_capa, id_livro
            ))
        except ValueError as erro:
            for nome in novos_arquivos:
                apagar_upload(nome)
            return resposta_erro(str(erro))
        except sqlite3.IntegrityError:
            for nome in novos_arquivos:
                apagar_upload(nome)
            return resposta_erro("A categoria informada não existe.")

    if nome_arquivo != livro["arquivo"]:
        apagar_upload(livro["arquivo"])
    if nome_capa != livro["capa"]:
        apagar_upload(livro["capa"])
    return jsonify({"mensagem": "Livro atualizado."})


@app.route("/api/livros/<id_livro>", methods=["DELETE"])
def excluir_livro(id_livro):
    with conectar() as conn:
        livro = livro_existe(conn, id_livro)
        if not livro:
            return resposta_erro("Livro não encontrado.", 404)
        conn.execute("DELETE FROM livros WHERE id = ?", (id_livro,))
    apagar_upload(livro["arquivo"])
    apagar_upload(livro["capa"])
    return jsonify({"mensagem": "Livro excluído."})


@app.route("/api/livros/<id_livro>/favorito", methods=["PATCH"])
def alternar_favorito(id_livro):
    with conectar() as conn:
        livro = livro_existe(conn, id_livro)
        if not livro:
            return resposta_erro("Livro não encontrado.", 404)
        novo = 0 if livro["favorito"] else 1
        conn.execute(
            "UPDATE livros SET favorito = ? WHERE id = ?", (novo, id_livro)
        )
    return jsonify({"favorito": novo})


@app.route("/api/livros/<id_livro>/status", methods=["PATCH"])
def atualizar_status(id_livro):
    status = (request.get_json(silent=True) or {}).get("status", "")
    with conectar() as conn:
        if not livro_existe(conn, id_livro):
            return resposta_erro("Livro não encontrado.", 404)
        conn.execute(
            "UPDATE livros SET status = ? WHERE id = ?", (status, id_livro)
        )
    return jsonify({"mensagem": "Status atualizado."})


# =========================================================
# 6. ROTAS DE CATEGORIAS
# =========================================================
@app.route("/api/categorias", methods=["GET"])
def listar_categorias():
    with conectar() as conn:
        categorias = conn.execute(
            "SELECT * FROM categorias ORDER BY nome COLLATE NOCASE"
        ).fetchall()
    return jsonify([dict(item) for item in categorias])


@app.route("/api/categorias", methods=["POST"])
def cadastrar_categoria():
    nome = (request.get_json(silent=True) or {}).get("nome", "").strip()
    if not nome:
        return resposta_erro("O nome da categoria é obrigatório.")
    id_categoria = str(uuid.uuid4())
    try:
        with conectar() as conn:
            conn.execute(
                "INSERT INTO categorias (id, nome) VALUES (?, ?)",
                (id_categoria, nome)
            )
    except sqlite3.IntegrityError:
        return resposta_erro("Já existe uma categoria com esse nome.")
    return jsonify({"id": id_categoria, "nome": nome}), 201


@app.route("/api/categorias/<id_categoria>", methods=["PUT"])
def editar_categoria(id_categoria):
    nome = (request.get_json(silent=True) or {}).get("nome", "").strip()
    if not nome:
        return resposta_erro("O nome da categoria é obrigatório.")
    try:
        with conectar() as conn:
            cursor = conn.execute(
                "UPDATE categorias SET nome = ? WHERE id = ?",
                (nome, id_categoria)
            )
            if not cursor.rowcount:
                return resposta_erro("Categoria não encontrada.", 404)
    except sqlite3.IntegrityError:
        return resposta_erro("Já existe uma categoria com esse nome.")
    return jsonify({"mensagem": "Categoria atualizada."})


@app.route("/api/categorias/<id_categoria>", methods=["DELETE"])
def excluir_categoria(id_categoria):
    with conectar() as conn:
        cursor = conn.execute(
            "DELETE FROM categorias WHERE id = ?", (id_categoria,)
        )
        if not cursor.rowcount:
            return resposta_erro("Categoria não encontrada.", 404)
    return jsonify({"mensagem": "Categoria excluída."})


# =========================================================
# 7. LEITURA DOS ARQUIVOS DOS LIVROS
# =========================================================
@app.route("/api/arquivos/<id_livro>", methods=["GET"])
def abrir_arquivo(id_livro):
    with conectar() as conn:
        livro = conn.execute(
            "SELECT arquivo FROM livros WHERE id = ?", (id_livro,)
        ).fetchone()
    if not livro or not livro["arquivo"]:
        return resposta_erro("Arquivo não encontrado.", 404)
    return send_from_directory(UPLOAD_FOLDER, livro["arquivo"], as_attachment=False)


# =========================================================
# 8. INICIALIZAÇÃO
# =========================================================
@app.errorhandler(413)
def arquivo_grande(_erro):
    return resposta_erro("O arquivo ultrapassa o limite permitido (80 MB).", 413)


if __name__ == "__main__":
    iniciar_banco()
    app.run(debug=True)