(() => {
  'use strict';

  // Os nomes do banco e da chave local são mantidos para preservar os dados existentes.
  const BANCO = 'saturno-files', VERSAO = 2, ARQUIVOS = 'arquivos', ARQUIVOS_ANTIGOS = 'files';
  const CHAVE = 'saturno-library-v1', LIMITE = 80 * 1024 * 1024;
  const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
  const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];
  const estado = { livros: [], categorias: [], tema: 'light', grade: 3, url: null, epub: null };

  function abrirBanco() {
    return new Promise((resolver, rejeitar) => {
      const pedido = indexedDB.open(BANCO, VERSAO);
      pedido.onupgradeneeded = () => {
        if (!pedido.result.objectStoreNames.length) pedido.result.createObjectStore(ARQUIVOS);
      };
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => rejeitar(pedido.error);
    });
  }

  async function guardarArquivo(acao) {
    const banco = await abrirBanco();
    const nomeLoja = banco.objectStoreNames.contains(ARQUIVOS) ? ARQUIVOS : ARQUIVOS_ANTIGOS;
    return new Promise((resolver, rejeitar) => {
      const transacao = banco.transaction(nomeLoja, 'readwrite');
      acao(transacao.objectStore(nomeLoja));
      transacao.oncomplete = () => { banco.close(); resolver(); };
      transacao.onerror = () => { banco.close(); rejeitar(transacao.error); };
    });
  }

  async function salvarArquivo(id, arquivo) {
    return guardarArquivo(loja => loja.put(arquivo, id));
  }

  async function buscarArquivo(id) {
    const banco = await abrirBanco();
    return new Promise((resolver, rejeitar) => {
      const nomeLoja = banco.objectStoreNames.contains(ARQUIVOS) ? ARQUIVOS : ARQUIVOS_ANTIGOS;
      const transacao = banco.transaction(nomeLoja, 'readonly');
      const pedido = transacao.objectStore(nomeLoja).get(id);
      pedido.onsuccess = () => { banco.close(); resolver(pedido.result || null); };
      pedido.onerror = () => { banco.close(); rejeitar(pedido.error); };
    });
  }

  async function excluirArquivo(id) {
    if (id) await guardarArquivo(loja => loja.delete(id));
  }

  function carregarDados() {
    try {
      const dados = JSON.parse(localStorage.getItem(CHAVE) || '{}');
      estado.livros = Array.isArray(dados.books) ? dados.books : [];
      estado.categorias = Array.isArray(dados.categories) ? dados.categories : [];
      estado.tema = dados.theme === 'dark' ? 'dark' : 'light';
      estado.grade = [2, 3, 4].includes(Number(dados.grid)) ? Number(dados.grid) : 3;
    } catch (erro) {
      console.error(erro);
      aviso('Não foi possível carregar os dados salvos.');
    }
  }

  function salvarDados() {
    try {
      localStorage.setItem(CHAVE, JSON.stringify({ books: estado.livros, categories: estado.categorias, theme: estado.tema, grid: estado.grade }));
    } catch (erro) {
      console.error(erro);
      aviso('Não foi possível salvar. Verifique o espaço disponível no navegador.');
    }
  }

  function aviso(mensagem) {
    const elemento = $('#aviso');
    elemento.textContent = mensagem;
    elemento.classList.add('visivel');
    clearTimeout(aviso.tempo);
    aviso.tempo = setTimeout(() => elemento.classList.remove('visivel'), 2800);
  }

  function seguro(valor = '') {
    return String(valor).replace(/[&<>"']/g, letra => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[letra]);
  }

  function nomeCategoria(id) {
    return estado.categorias.find(categoria => categoria.id === id)?.name || 'Sem categoria';
  }

  function atualizarTema() {
    document.body.classList.toggle('escuro', estado.tema === 'dark');
    $('#tema').textContent = estado.tema === 'dark' ? '☀' : '☾';
    $('#tema').setAttribute('aria-label', estado.tema === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro');
  }

  function alternarTema() {
    estado.tema = estado.tema === 'dark' ? 'light' : 'dark';
    salvarDados(); atualizarTema();
  }

  function pagina(nome) {
    $$('.pagina').forEach(item => item.classList.toggle('ativa', item.id === `pagina-${nome}`));
    $$('.link').forEach(item => item.classList.toggle('ativo', item.dataset.pagina === nome));
    $('#secao-atual').textContent = ({ inicio: 'Visão geral', catalogo: 'Meu catálogo', categorias: 'Categorias' })[nome];
    $('#barra').classList.remove('aberta');
    renderizar();
  }

  function vazio(titulo, texto, acao = '') {
    return `<div class="vazio"><span class="icone-vazio">✧</span><b>${titulo}</b><p>${texto}</p>${acao}</div>`;
  }

  function cartaoLivro(livro) {
    const capa = livro.cover
      ? `<img src="${livro.cover}" alt="Capa de ${seguro(livro.title)}">`
      : `<div class="capa-sem-imagem">${seguro((livro.title || '').slice(0, 34))}</div>`;
    return `<article class="cartao-livro"><div class="capa-livro">${capa}</div>
      <h3>${seguro(livro.title)}</h3><p>${seguro(livro.author || 'Autor não informado')}</p>
      <div class="metadados"><span class="etiqueta">${seguro(nomeCategoria(livro.categoryId))}</span><span>${seguro(livro.year || '')}</span></div>
      <div class="acoes-livro"><button class="botao-pequeno" data-acao="detalhes" data-id="${livro.id}">Detalhes</button>
      <button class="botao-pequeno" data-acao="abrir" data-id="${livro.id}" ${livro.fileId ? '' : 'disabled'}>Abrir</button>
      <button class="botao-pequeno" data-acao="editar-livro" data-id="${livro.id}">Editar</button>
      <button class="botao-pequeno perigo" data-acao="excluir-livro" data-id="${livro.id}">Excluir</button></div></article>`;
  }

  function atualizarOpcoes() {
    const opcoes = estado.categorias.map(item => `<option value="${seguro(item.id)}">${seguro(item.name)}</option>`).join('');
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
    const resumo = $('#resumo-categorias');
    resumo.innerHTML = estado.categorias.length ? estado.categorias.map(categoria => {
      const quantidade = estado.livros.filter(livro => livro.categoryId === categoria.id).length;
      const percentual = estado.livros.length ? quantidade / estado.livros.length * 100 : 0;
      return `<div class="linha-categoria"><span>${seguro(categoria.name)}</span><div class="trilho"><div class="preenchimento" style="width:${percentual}%"></div></div><b>${quantidade}</b></div>`;
    }).join('') : 'Suas categorias aparecerão aqui quando você começar a organizar o acervo.';
    const recentes = [...estado.livros].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 3);
    $('#livros-recentes').innerHTML = recentes.length ? recentes.map(cartaoLivro).join('') : vazio('Sua estante está esperando por você', 'Adicione seu primeiro livro para começar.', '<button class="botao secundario" data-acao="novo-livro">Adicionar primeiro livro</button>');
  }

  function renderizarCatalogo() {
    const busca = $('#busca').value.trim().toLocaleLowerCase('pt-BR');
    const categoria = $('#filtro-categoria').value, ordem = $('#ordem').value;
    const livros = estado.livros.filter(item => item.title.toLocaleLowerCase('pt-BR').includes(busca) && (!categoria || item.categoryId === categoria));
    livros.sort((a, b) => ordem === 'titulo' ? a.title.localeCompare(b.title, 'pt-BR') : ordem === 'autor' ? (a.author || '').localeCompare(b.author || '', 'pt-BR') : (b.createdAt || 0) - (a.createdAt || 0));
    $('#grade-catalogo').innerHTML = livros.length ? livros.map(cartaoLivro).join('') : vazio(busca || categoria ? 'Nenhum resultado encontrado' : 'Nenhum livro cadastrado', busca || categoria ? 'Altere a pesquisa ou o filtro.' : 'Seu catálogo está vazio. Adicione um título para começar.', '<button class="botao secundario" data-acao="novo-livro">＋ Adicionar livro</button>');
  }

  function renderizarCategorias() {
    $('#grade-categorias').innerHTML = estado.categorias.length ? estado.categorias.map(categoria => {
      const quantidade = estado.livros.filter(livro => livro.categoryId === categoria.id).length;
      return `<article class="cartao-categoria"><h3>${seguro(categoria.name)}</h3><p>${quantidade} ${quantidade === 1 ? 'livro' : 'livros'}</p><div class="acoes-livro">
        <button class="botao-pequeno" data-acao="ver-categoria" data-id="${categoria.id}">Ver livros</button><button class="botao-pequeno" data-acao="editar-categoria" data-id="${categoria.id}">Editar</button><button class="botao-pequeno perigo" data-acao="excluir-categoria" data-id="${categoria.id}">Excluir</button></div></article>`;
    }).join('') : vazio('Nenhuma categoria criada', 'Crie sua primeira categoria para organizar os livros.', '<button class="botao secundario" data-acao="nova-categoria">＋ Criar categoria</button>');
  }

  function renderizar() { atualizarOpcoes(); renderizarInicio(); renderizarCatalogo(); renderizarCategorias(); }

  function formularioLivro(livro = null) {
    $('#form-livro').reset();
    $('#id-livro').value = livro?.id || '';
    $('#titulo-modal-livro').textContent = livro ? 'Editar livro' : 'Adicionar livro';
    $('#titulo').value = livro?.title || ''; $('#autor').value = livro?.author || '';
    $('#ano').value = livro?.year || ''; $('#categoria-livro').value = livro?.categoryId || '';
    $('#descricao').value = livro?.description || '';
    $('#aviso-arquivo').textContent = livro?.fileName ? `Arquivo atual: ${livro.fileName}. Envie outro para substituir.` : 'O arquivo será mantido neste navegador.';
    $('#modal-livro').showModal();
  }

  function lerImagem(arquivo) {
    return new Promise((resolver, rejeitar) => {
      const leitor = new FileReader();
      leitor.onload = () => resolver(leitor.result); leitor.onerror = () => rejeitar(leitor.error);
      leitor.readAsDataURL(arquivo);
    });
  }

  async function salvarLivro(evento) {
    evento.preventDefault();
    const id = $('#id-livro').value || crypto.randomUUID();
    const anterior = estado.livros.find(item => item.id === id);
    const arquivo = $('#arquivo').files[0], imagem = $('#capa').files[0];
    if (arquivo && !/\.(pdf|epub)$/i.test(arquivo.name)) return aviso('Selecione um arquivo PDF ou EPUB.');
    if (arquivo && arquivo.size > LIMITE) return aviso('O arquivo ultrapassa o limite de 80 MB.');
    try {
      const idArquivo = arquivo ? id : (anterior?.fileId || '');
      if (arquivo) await salvarArquivo(id, arquivo);
      const livro = {
        id, title: $('#titulo').value.trim(), author: $('#autor').value.trim(), year: $('#ano').value,
        categoryId: $('#categoria-livro').value, description: $('#descricao').value.trim(),
        cover: imagem ? await lerImagem(imagem) : (anterior?.cover || ''),
        fileId: idArquivo, fileName: arquivo?.name || anterior?.fileName || '', createdAt: anterior?.createdAt || Date.now()
      };
      estado.livros = anterior ? estado.livros.map(item => item.id === id ? livro : item) : [...estado.livros, livro];
      salvarDados(); $('#modal-livro').close(); renderizar(); aviso(anterior ? 'Livro atualizado.' : 'Livro adicionado.');
    } catch (erro) { console.error(erro); aviso('Não foi possível salvar o livro ou o arquivo.'); }
  }

  function formularioCategoria(categoria = null) {
    $('#form-categoria').reset(); $('#id-categoria').value = categoria?.id || '';
    $('#nome-categoria').value = categoria?.name || '';
    $('#titulo-modal-categoria').textContent = categoria ? 'Editar categoria' : 'Nova categoria';
    $('#modal-categoria').showModal();
  }

  function salvarCategoria(evento) {
    evento.preventDefault();
    const id = $('#id-categoria').value || crypto.randomUUID(), nome = $('#nome-categoria').value.trim();
    if (estado.categorias.some(item => item.id !== id && item.name.toLocaleLowerCase('pt-BR') === nome.toLocaleLowerCase('pt-BR'))) return aviso('Já existe uma categoria com esse nome.');
    const categoria = { id, name: nome };
    estado.categorias = estado.categorias.some(item => item.id === id) ? estado.categorias.map(item => item.id === id ? categoria : item) : [...estado.categorias, categoria];
    salvarDados(); $('#modal-categoria').close(); renderizar(); aviso('Categoria salva.');
  }

  function mostrarDetalhes(livro) {
    const capa = livro.cover ? `<img class="detalhes-capa" src="${livro.cover}" alt="Capa do livro">` : '<div class="detalhes-capa capa-sem-imagem">✧</div>';
    $('#detalhes').innerHTML = `<div class="detalhes-livro">${capa}<div><small class="destaque">DETALHES DO LIVRO</small><h2>${seguro(livro.title)}</h2><p>${seguro(livro.author || 'Autor não informado')}</p><span class="etiqueta">${seguro(nomeCategoria(livro.categoryId))}</span><p>${seguro(livro.description || 'Nenhuma descrição cadastrada.')}</p><p>Ano: ${seguro(livro.year || 'Não informado')}<br>Arquivo: ${seguro(livro.fileName || 'Não anexado')}</p></div></div>`;
    $('#modal-detalhes').showModal();
  }

  async function abrirLeitor(livro) {
    try {
      const arquivo = await buscarArquivo(livro.fileId);
      if (!arquivo) return aviso('Arquivo não encontrado neste navegador.');
      $('#titulo-leitor').textContent = livro.title;
      const area = $('#conteudo-leitor'); area.innerHTML = '';
      $('#anterior').disabled = $('#proximo').disabled = /\.pdf$/i.test(arquivo.name);
      if (/\.pdf$/i.test(arquivo.name)) {
        estado.url = URL.createObjectURL(arquivo);
        area.innerHTML = `<iframe title="Leitor de PDF" src="${estado.url}"></iframe>`;
      } else if (/\.epub$/i.test(arquivo.name) && window.ePub) {
        area.innerHTML = '<div id="visualizador-epub"></div>';
        estado.epub = window.ePub(await arquivo.arrayBuffer()).renderTo('visualizador-epub', { width: '100%', height: '65vh', spread: 'none' });
        await estado.epub.display();
      } else return aviso('Não foi possível carregar o leitor EPUB.');
      $('#modal-leitor').showModal();
    } catch (erro) { console.error(erro); aviso('Não foi possível abrir o arquivo.'); }
  }

  async function executarAcao(acao, id) {
    const livro = estado.livros.find(item => item.id === id), categoria = estado.categorias.find(item => item.id === id);
    switch (acao) {
      case 'novo-livro': formularioLivro(); break;
      case 'editar-livro': if (livro) formularioLivro(livro); break;
      case 'detalhes': if (livro) mostrarDetalhes(livro); break;
      case 'abrir': if (livro?.fileId) await abrirLeitor(livro); break;
      case 'nova-categoria': formularioCategoria(); break;
      case 'editar-categoria': if (categoria) formularioCategoria(categoria); break;
      case 'ver-categoria': $('#filtro-categoria').value = id; pagina('catalogo'); break;
      case 'excluir-categoria':
        if (categoria && confirm(`Excluir "${categoria.name}"? Os livros ficarão sem categoria.`)) {
          estado.categorias = estado.categorias.filter(item => item.id !== id);
          estado.livros.forEach(item => { if (item.categoryId === id) item.categoryId = ''; });
          salvarDados(); renderizar(); aviso('Categoria excluída.');
        }
        break;
      case 'excluir-livro':
        if (livro && confirm(`Excluir "${livro.title}" do acervo?`)) {
          try { await excluirArquivo(livro.fileId); estado.livros = estado.livros.filter(item => item.id !== id); salvarDados(); renderizar(); aviso('Livro excluído.'); }
          catch (erro) { console.error(erro); aviso('Não foi possível excluir o arquivo.'); }
        }
        break;
    }
  }

  function configurarEventos() {
    document.addEventListener('click', async evento => {
      const fechar = evento.target.closest('[data-fechar]');
      if (fechar) return $(`#${fechar.dataset.fechar}`).close();
      const link = evento.target.closest('[data-pagina]');
      if (link) { evento.preventDefault(); return pagina(link.dataset.pagina); }
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
      estado.url = null; estado.epub = null; $('#conteudo-leitor').innerHTML = '';
    });
    ['modal-livro', 'modal-categoria', 'modal-detalhes', 'modal-leitor'].forEach(id => {
      $(`#${id}`).addEventListener('click', evento => { if (evento.target === evento.currentTarget) evento.currentTarget.close(); });
    });
  }

  function iniciar() {
    carregarDados(); atualizarTema(); configurarEventos();
    $('#data-atual').textContent = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', weekday: 'short' }).format(new Date());
    renderizar();
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();