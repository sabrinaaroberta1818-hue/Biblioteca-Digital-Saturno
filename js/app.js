(() => {
  'use strict';

  // =========================================================
  // 1. CONFIGURAÇÃO E ESTADO
  // =========================================================
  const API = '/api';
  const CHAVE = 'saturno-library-v1';
  const BANCO_ANTIGO = 'saturno-files';
  const LOJA_NOVA = 'arquivos';
  const LOJA_ANTIGA = 'files';
  const LIMITE = 80 * 1024 * 1024;

  const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
  const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];
  const estado = {
    livros: [], categorias: [], tema: 'light',
    url: null, epub: null
  };

  // =========================================================
  // 2. COMUNICAÇÃO COM O BACK-END
  // =========================================================
  async function requisicao(url, opcoes = {}) {
    const resposta = await fetch(`${API}${url}`, opcoes);
    const dados = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(dados.erro || 'Falha na comunicação com o servidor.');
    return dados;
  }

  function mapearLivro(livro) {
    return {
      id: livro.id,
      title: livro.titulo,
      author: livro.autor || '',
      year: livro.ano || '',
      description: livro.descricao || '',
      categoryId: livro.categoria_id || '',
      fileName: livro.arquivo || '',
      fileId: livro.arquivo ? livro.id : '',
      cover: livro.capa ? `/uploads/${encodeURIComponent(livro.capa)}` : '',
      favorite: Boolean(livro.favorito),
      status: livro.status || '',
      createdAt: livro.criado_em || 0
    };
  }

  async function carregarDados() {
    const [livros, categorias] = await Promise.all([
      requisicao('/livros'),
      requisicao('/categorias')
    ]);
    estado.livros = livros.map(mapearLivro);
    estado.categorias = categorias.map(item => ({ id: item.id, name: item.nome }));
  }

  // =========================================================
  // 3. COMPATIBILIDADE COM DADOS DA VERSÃO LOCAL ANTERIOR
  //    Migra localStorage/IndexedDB uma única vez para SQLite.
  // =========================================================
  function abrirBancoAntigo() {
    return new Promise((resolver) => {
      if (!window.indexedDB) return resolver(null);
      const pedido = indexedDB.open(BANCO_ANTIGO);
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => resolver(null);
      pedido.onblocked = () => resolver(null);
    });
  }

  async function arquivoAntigo(id) {
    const banco = await abrirBancoAntigo();
    if (!banco) return null;
    const loja = banco.objectStoreNames.contains(LOJA_NOVA) ? LOJA_NOVA :
      banco.objectStoreNames.contains(LOJA_ANTIGA) ? LOJA_ANTIGA : null;
    if (!loja) { banco.close(); return null; }

    return new Promise(resolver => {
      const pedido = banco.transaction(loja, 'readonly').objectStore(loja).get(id);
      pedido.onsuccess = () => { banco.close(); resolver(pedido.result || null); };
      pedido.onerror = () => { banco.close(); resolver(null); };
    });
  }

  function dataUrlParaArquivo(dataUrl, nome) {
    if (!dataUrl || !dataUrl.startsWith('data:')) return null;
    const [cabecalho, conteudo] = dataUrl.split(',');
    const tipo = cabecalho.match(/:(.*?);/)?.[1] || 'image/jpeg';
    const binario = atob(conteudo);
    const bytes = Uint8Array.from(binario, letra => letra.charCodeAt(0));
    return new File([bytes], nome, { type: tipo });
  }

  async function migrarDadosAntigos() {
    if (localStorage.getItem(`${CHAVE}-migrado`)) return;

    let antigos;
    try { antigos = JSON.parse(localStorage.getItem(CHAVE) || '{}'); }
    catch { antigos = {}; }

    const livrosAntigos = Array.isArray(antigos.books) ? antigos.books : [];
    const categoriasAntigas = Array.isArray(antigos.categories) ? antigos.categories : [];

    // Só importa se o banco novo estiver vazio, evitando duplicações.
    const atuais = await requisicao('/livros');
    const catsAtuais = await requisicao('/categorias');
    if (atuais.length || catsAtuais.length) {
      localStorage.setItem(`${CHAVE}-migrado`, '1');
      return;
    }

    const idsCategorias = new Map();
    for (const categoria of categoriasAntigas) {
      const nova = await requisicao('/categorias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: categoria.name })
      });
      idsCategorias.set(categoria.id, nova.id);
    }

    for (const livro of livrosAntigos) {
      const formulario = new FormData();
      formulario.append('titulo', livro.title || 'Livro sem título');
      formulario.append('autor', livro.author || '');
      formulario.append('ano', livro.year || '');
      formulario.append('descricao', livro.description || '');
      formulario.append('categoria_id', idsCategorias.get(livro.categoryId) || '');
      if (livro.cover?.startsWith('data:')) {
        const capa = dataUrlParaArquivo(livro.cover, 'capa.jpg');
        if (capa) formulario.append('capa', capa);
      }
      if (livro.fileId) {
        const arquivo = await arquivoAntigo(livro.fileId);
        if (arquivo) formulario.append('arquivo', arquivo, arquivo.name || livro.fileName || 'livro.pdf');
      }
      const novo = await requisicao('/livros', { method: 'POST', body: formulario });
      if (livro.favorite) {
        await requisicao(`/livros/${novo.id}/favorito`, { method: 'PATCH' });
      }
      if (livro.status) {
        await requisicao(`/livros/${novo.id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: livro.status })
        });
      }
    }

    localStorage.setItem(`${CHAVE}-migrado`, '1');
    // Preferências visuais continuam locais; os dados bibliográficos passam ao SQLite.
    localStorage.setItem(`${CHAVE}-preferencias`, JSON.stringify({ theme: antigos.theme || 'light' }));
  }

  // =========================================================
  // 4. PREFERÊNCIAS, AVISOS E FUNÇÕES AUXILIARES
  // =========================================================
  function carregarPreferencias() {
    try {
      const dados = JSON.parse(localStorage.getItem(`${CHAVE}-preferencias`) || '{}');
      estado.tema = dados.theme === 'dark' ? 'dark' : 'light';
    } catch { estado.tema = 'light'; }
  }

  function salvarPreferencias() {
    localStorage.setItem(`${CHAVE}-preferencias`, JSON.stringify({ theme: estado.tema }));
  }

  function aviso(mensagem) {
    const elemento = $('#aviso');
    elemento.textContent = mensagem;
    elemento.classList.add('visivel');
    clearTimeout(aviso.tempo);
    aviso.tempo = setTimeout(() => elemento.classList.remove('visivel'), 2800);
  }

  function seguro(valor = '') {
    return String(valor).replace(/[&<>"']/g, letra => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[letra]);
  }

  function nomeCategoria(id) {
    return estado.categorias.find(item => item.id === id)?.name || 'Sem categoria';
  }

  function atualizarTema() {
    document.body.classList.toggle('escuro', estado.tema === 'dark');
    $('#tema').textContent = estado.tema === 'dark' ? '☀' : '☾';
    $('#tema').setAttribute('aria-label',
      estado.tema === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro');
  }

  function alternarTema() {
    estado.tema = estado.tema === 'dark' ? 'light' : 'dark';
    salvarPreferencias();
    atualizarTema();
  }

  // =========================================================
  // 5. NAVEGAÇÃO E RENDERIZAÇÃO DAS TELAS
  // =========================================================
  function pagina(nome) {
    $$('.pagina').forEach(item =>
      item.classList.toggle('ativa', item.id === `pagina-${nome}`));
    $$('.link').forEach(item =>
      item.classList.toggle('ativo', item.dataset.pagina === nome));
    $('#secao-atual').textContent = ({
      inicio: 'Visão geral', catalogo: 'Meu catálogo', categorias: 'Categorias'
    })[nome];
    $('#barra').classList.remove('aberta');
    renderizar();
  }

  function vazio(titulo, texto, acao = '') {
    return `<div class="vazio"><span class="icone-vazio">✧</span>
      <b>${titulo}</b><p>${texto}</p>${acao}</div>`;
  }

  function cartaoLivro(livro) {
    const capa = livro.cover
      ? `<img src="${seguro(livro.cover)}" alt="Capa de ${seguro(livro.title)}">`
      : `<div class="capa-sem-imagem">${seguro((livro.title || '').slice(0, 34))}</div>`;
    return `<article class="cartao-livro">
      <div class="capa-livro">${capa}</div>
      <h3>${seguro(livro.title)}</h3>
      <p>${seguro(livro.author || 'Autor não informado')}</p>
      <div class="metadados">
        <span class="etiqueta">${seguro(nomeCategoria(livro.categoryId))}</span>
        <span>${seguro(livro.year || '')}</span>
      </div>
      <div class="acoes-livro">
        <button class="botao-pequeno" data-acao="detalhes" data-id="${livro.id}">Detalhes</button>
        <button class="botao-pequeno" data-acao="abrir" data-id="${livro.id}" ${livro.fileId ? '' : 'disabled'}>Abrir</button>
        <button class="botao-pequeno" data-acao="editar-livro" data-id="${livro.id}">Editar</button>
        <button class="botao-pequeno perigo" data-acao="excluir-livro" data-id="${livro.id}">Excluir</button>
      </div>
    </article>`;
  }

  function atualizarOpcoes() {
    const opcoes = estado.categorias.map(item =>
      `<option value="${seguro(item.id)}">${seguro(item.name)}</option>`).join('');
    const filtro = $('#filtro-categoria'), atual = filtro.value;
    filtro.innerHTML = '<option value="">Todas as categorias</option>' + opcoes;
    filtro.value = atual;
    const campo = $('#categoria-livro'), selecionada = campo.value;
    campo.innerHTML = '<option value="">Sem categoria</option>' + opcoes;
    campo.value = selecionada;
  }

  function renderizarInicio() {
    $('#total-livros').textContent = estado.livros.length;
    $('#total-categorias').textContent = estado.categorias.length;
    $('#resumo-categorias').innerHTML = estado.categorias.length
      ? estado.categorias.map(categoria => {
          const quantidade = estado.livros.filter(item =>
            item.categoryId === categoria.id).length;
          const percentual = estado.livros.length
            ? quantidade / estado.livros.length * 100 : 0;
          return `<div class="linha-categoria"><span>${seguro(categoria.name)}</span>
            <div class="trilho"><div class="preenchimento" style="width:${percentual}%"></div></div>
            <b>${quantidade}</b></div>`;
        }).join('')
      : 'Suas categorias aparecerão aqui quando você começar a organizar o acervo.';

    const recentes = [...estado.livros]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 3);
    $('#livros-recentes').innerHTML = recentes.length
      ? recentes.map(cartaoLivro).join('')
      : vazio('Sua estante está esperando por você',
        'Adicione seu primeiro livro para começar.',
        '<button class="botao secundario" data-acao="novo-livro">Adicionar primeiro livro</button>');
  }

  function renderizarCatalogo() {
    const busca = $('#busca').value.trim().toLocaleLowerCase('pt-BR');
    const categoria = $('#filtro-categoria').value, ordem = $('#ordem').value;
    const livros = estado.livros.filter(item =>
      item.title.toLocaleLowerCase('pt-BR').includes(busca) &&
      (!categoria || item.categoryId === categoria));
    livros.sort((a, b) => ordem === 'titulo'
      ? a.title.localeCompare(b.title, 'pt-BR')
      : ordem === 'autor'
        ? (a.author || '').localeCompare(b.author || '', 'pt-BR')
        : (b.createdAt || 0) - (a.createdAt || 0));
    $('#grade-catalogo').innerHTML = livros.length
      ? livros.map(cartaoLivro).join('')
      : vazio(busca || categoria ? 'Nenhum resultado encontrado' : 'Nenhum livro cadastrado',
        busca || categoria ? 'Altere a pesquisa ou o filtro.' :
          'Seu catálogo está vazio. Adicione um título para começar.',
        '<button class="botao secundario" data-acao="novo-livro">＋ Adicionar livro</button>');
  }

  function renderizarCategorias() {
    $('#grade-categorias').innerHTML = estado.categorias.length
      ? estado.categorias.map(categoria => {
          const quantidade = estado.livros.filter(item =>
            item.categoryId === categoria.id).length;
          return `<article class="cartao-categoria"><h3>${seguro(categoria.name)}</h3>
            <p>${quantidade} ${quantidade === 1 ? 'livro' : 'livros'}</p>
            <div class="acoes-livro">
              <button class="botao-pequeno" data-acao="ver-categoria" data-id="${categoria.id}">Ver livros</button>
              <button class="botao-pequeno" data-acao="editar-categoria" data-id="${categoria.id}">Editar</button>
              <button class="botao-pequeno perigo" data-acao="excluir-categoria" data-id="${categoria.id}">Excluir</button>
            </div></article>`;
        }).join('')
      : vazio('Nenhuma categoria criada',
        'Crie sua primeira categoria para organizar os livros.',
        '<button class="botao secundario" data-acao="nova-categoria">＋ Criar categoria</button>');
  }

  function renderizar() {
    atualizarOpcoes();
    renderizarInicio();
    renderizarCatalogo();
    renderizarCategorias();
  }

  // =========================================================
  // 6. CADASTRO E EDIÇÃO DE LIVROS
  // =========================================================
  function formularioLivro(livro = null) {
    $('#form-livro').reset();
    $('#id-livro').value = livro?.id || '';
    $('#titulo-modal-livro').textContent = livro ? 'Editar livro' : 'Adicionar livro';
    $('#titulo').value = livro?.title || '';
    $('#autor').value = livro?.author || '';
    $('#ano').value = livro?.year || '';
    $('#categoria-livro').value = livro?.categoryId || '';
    $('#descricao').value = livro?.description || '';
    $('#aviso-arquivo').textContent = livro?.fileName
      ? `Arquivo atual: ${livro.fileName}. Envie outro para substituir.`
      : 'O arquivo será armazenado no servidor.';
    $('#modal-livro').showModal();
  }

  async function salvarLivro(evento) {
    evento.preventDefault();
    const id = $('#id-livro').value;
    const arquivo = $('#arquivo').files[0];
    const capa = $('#capa').files[0];

    if (arquivo && !/\.(pdf|epub)$/i.test(arquivo.name))
      return aviso('Selecione um arquivo PDF ou EPUB.');
    if (arquivo && arquivo.size > LIMITE)
      return aviso('O arquivo ultrapassa o limite de 80 MB.');
    if (capa && !capa.type.startsWith('image/'))
      return aviso('Selecione um arquivo de imagem para a capa.');

    const formulario = new FormData();
    formulario.append('titulo', $('#titulo').value.trim());
    formulario.append('autor', $('#autor').value.trim());
    formulario.append('ano', $('#ano').value);
    formulario.append('descricao', $('#descricao').value.trim());
    formulario.append('categoria_id', $('#categoria-livro').value);
    if (arquivo) formulario.append('arquivo', arquivo);
    if (capa) formulario.append('capa', capa);

    try {
      await requisicao(id ? `/livros/${id}` : '/livros', {
        method: id ? 'PUT' : 'POST', body: formulario
      });
      await carregarDados();
      $('#modal-livro').close();
      renderizar();
      aviso(id ? 'Livro atualizado.' : 'Livro adicionado.');
    } catch (erro) {
      console.error(erro);
      aviso(erro.message || 'Não foi possível salvar o livro.');
    }
  }

  // =========================================================
  // 7. CATEGORIAS
  // =========================================================
  function formularioCategoria(categoria = null) {
    $('#form-categoria').reset();
    $('#id-categoria').value = categoria?.id || '';
    $('#nome-categoria').value = categoria?.name || '';
    $('#titulo-modal-categoria').textContent =
      categoria ? 'Editar categoria' : 'Nova categoria';
    $('#modal-categoria').showModal();
  }

  async function salvarCategoria(evento) {
    evento.preventDefault();
    const id = $('#id-categoria').value;
    const nome = $('#nome-categoria').value.trim();
    try {
      await requisicao(id ? `/categorias/${id}` : '/categorias', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome })
      });
      await carregarDados();
      $('#modal-categoria').close();
      renderizar();
      aviso('Categoria salva.');
    } catch (erro) {
      aviso(erro.message || 'Não foi possível salvar a categoria.');
    }
  }

  // =========================================================
  // 8. DETALHES E LEITOR DE ARQUIVOS
  // =========================================================
  function mostrarDetalhes(livro) {
    const capa = livro.cover
      ? `<img class="detalhes-capa" src="${seguro(livro.cover)}" alt="Capa do livro">`
      : '<div class="detalhes-capa capa-sem-imagem">✧</div>';
    $('#detalhes').innerHTML = `<div class="detalhes-livro">${capa}<div>
      <small class="destaque">DETALHES DO LIVRO</small>
      <h2>${seguro(livro.title)}</h2>
      <p>${seguro(livro.author || 'Autor não informado')}</p>
      <span class="etiqueta">${seguro(nomeCategoria(livro.categoryId))}</span>
      <p>${seguro(livro.description || 'Nenhuma descrição cadastrada.')}</p>
      <p>Ano: ${seguro(livro.year || 'Não informado')}<br>
      Arquivo: ${seguro(livro.fileName || 'Não anexado')}</p>
    </div></div>`;
    $('#modal-detalhes').showModal();
  }

  async function abrirLeitor(livro) {
    try {
      const resposta = await fetch(`${API}/arquivos/${livro.id}`);
      if (!resposta.ok) throw new Error('Arquivo não encontrado.');
      const arquivo = await resposta.blob();
      const nome = livro.fileName || '';
      $('#titulo-leitor').textContent = livro.title;
      const area = $('#conteudo-leitor');
      area.innerHTML = '';
      $('#anterior').disabled = $('#proximo').disabled = /\.pdf$/i.test(nome);

      estado.url = URL.createObjectURL(arquivo);
      if (/\.pdf$/i.test(nome)) {
        area.innerHTML = `<iframe title="Leitor de PDF" src="${estado.url}"></iframe>`;
      } else if (/\.epub$/i.test(nome) && window.ePub) {
        area.innerHTML = '<div id="visualizador-epub"></div>';
        estado.epub = window.ePub(await arquivo.arrayBuffer()).renderTo('visualizador-epub', {
          width: '100%', height: '65vh', spread: 'none'
        });
        await estado.epub.display();
      } else {
        URL.revokeObjectURL(estado.url);
        estado.url = null;
        return aviso('Não foi possível abrir o arquivo EPUB.');
      }
      $('#modal-leitor').showModal();
    } catch (erro) {
      console.error(erro);
      aviso(erro.message || 'Não foi possível abrir o arquivo.');
    }
  }

  // =========================================================
  // 9. AÇÕES DE LIVROS, CATEGORIAS E INTERFACE
  // =========================================================
  async function executarAcao(acao, id) {
    const livro = estado.livros.find(item => item.id === id);
    const categoria = estado.categorias.find(item => item.id === id);

    try {
      switch (acao) {
        case 'novo-livro': formularioLivro(); break;
        case 'editar-livro': if (livro) formularioLivro(livro); break;
        case 'detalhes': if (livro) mostrarDetalhes(livro); break;
        case 'abrir': if (livro?.fileId) await abrirLeitor(livro); break;
        case 'nova-categoria': formularioCategoria(); break;
        case 'editar-categoria': if (categoria) formularioCategoria(categoria); break;
        case 'ver-categoria':
          $('#filtro-categoria').value = id;
          pagina('catalogo');
          break;
        case 'excluir-categoria':
          if (categoria && confirm(`Excluir "${categoria.name}"? Os livros ficarão sem categoria.`)) {
            await requisicao(`/categorias/${id}`, { method: 'DELETE' });
            await carregarDados();
            renderizar();
            aviso('Categoria excluída.');
          }
          break;
        case 'excluir-livro':
          if (livro && confirm(`Excluir "${livro.title}" do acervo?`)) {
            await requisicao(`/livros/${id}`, { method: 'DELETE' });
            await carregarDados();
            renderizar();
            aviso('Livro excluído.');
          }
          break;
      }
    } catch (erro) {
      console.error(erro);
      aviso(erro.message || 'Não foi possível concluir a operação.');
    }
  }

  // =========================================================
  // 10. EVENTOS E INICIALIZAÇÃO
  // =========================================================
  function configurarEventos() {
    document.addEventListener('click', async evento => {
      const fechar = evento.target.closest('[data-fechar]');
      if (fechar) return $(`#${fechar.dataset.fechar}`).close();

      const link = evento.target.closest('[data-pagina]');
      if (link) {
        evento.preventDefault();
        return pagina(link.dataset.pagina);
      }

      const acao = evento.target.closest('[data-acao]');
      if (acao) await executarAcao(acao.dataset.acao, acao.dataset.id);
    });

    $('#form-livro').addEventListener('submit', salvarLivro);
    $('#form-categoria').addEventListener('submit', salvarCategoria);
    $('#busca').addEventListener('input', renderizarCatalogo);
    $('#filtro-categoria').addEventListener('change', renderizarCatalogo);
    $('#ordem').addEventListener('change', renderizarCatalogo);
    $('#tema').addEventListener('click', alternarTema);
    $('#menu').addEventListener('click', () => $('#barra').classList.toggle('aberta'));
    $('#anterior').addEventListener('click', () => estado.epub?.prev());
    $('#proximo').addEventListener('click', () => estado.epub?.next());

    $('#modal-leitor').addEventListener('close', () => {
      if (estado.url) URL.revokeObjectURL(estado.url);
      estado.url = null;
      estado.epub = null;
      $('#conteudo-leitor').innerHTML = '';
    });

    ['modal-livro', 'modal-categoria', 'modal-detalhes', 'modal-leitor']
      .forEach(id => {
        $(`#${id}`).addEventListener('click', evento => {
          if (evento.target === evento.currentTarget) evento.currentTarget.close();
        });
      });
  }

  async function iniciar() {
    configurarEventos();
    carregarPreferencias();
    atualizarTema();
    $('#data-atual').textContent = new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: 'short', weekday: 'short'
    }).format(new Date());

    try {
      await migrarDadosAntigos();
      await carregarDados();
      renderizar();
    } catch (erro) {
      console.error(erro);
      aviso('Não foi possível conectar ao servidor. Inicie o back-end Python.');
    }
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();