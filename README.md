# Saturno — Biblioteca Digital

Protótipo de front-end de uma biblioteca digital, desenvolvido com HTML, CSS e JavaScript puro. A estrutura separa os dados fictícios da lógica de interface para facilitar a futura integração com uma API em Python e banco de dados MySQL.

## Estrutura
saturno-biblioteca/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── app.js
│   └── data/
│       └── mockData.js
└── README.md

## Mock Data
`js/data/mockData.js` concentra os dados iniciais da aplicação em `window.SATURNO_MOCK_DATA`:
- **300 livros**, seguindo a lista de títulos e autores fornecida, distribuídos nas 10 categorias temáticas.
- **50 usuários fictícios**, com nomes, e-mails Gmail exclusivos, telefones, datas de cadastro, perfil e status.
- Empréstimos de demonstração associados a usuários e livros do catálogo.
- Categorias, favoritos, listas de leitura e atividades iniciais.

`js/app.js` consome esses dados e mantém a persistência local via `localStorage`. A chave `version` permite reinicializar os dados de demonstração quando a versão do Mock Data for alterada. Para testar a carga inicial novamente, limpe os dados do site/localStorage ou incremente `version` em `mockData.js`.

## Preparação para Python + MySQL
A separação foi pensada para uma futura arquitetura em camadas:

| Front-end atual | Futuro back-end |
|---|---|
| `js/data/mockData.js` | Dados iniciais/fixtures para desenvolvimento e testes |
| `js/app.js` | Camada de interface; futuramente chama serviços HTTP |
| Objetos `books`, `users`, `loans` | Entidades/tabelas `books`, `users`, `loans` |
| `localStorage` | MySQL acessado exclusivamente pelo back-end Python |

Os registros são totalmente fictícios e servem apenas para demonstração/testes. Não use os e-mails de exemplo como contatos reais.

## Funcionalidades
- Dashboard com indicadores e movimentações.
- Catálogo com busca e filtros.
- Favoritos e listas de leitura.
- Cadastro, edição e exclusão de livros.
- Gestão de categorias e usuários.
- Empréstimos e devoluções.
- Alternância entre os modos Gerenciador(a) e Leitor(a).
- Tema claro/escuro e persistência local.

## Limitações do protótipo
Não há autenticação real, banco de dados conectado, upload efetivo de PDF/EPUB, leitor de arquivos, sincronização entre dispositivos ou autorização segura. A alternância de perfil é apenas demonstrativa. O modo Leitor(a) oculta as opções administrativas na interface, mas isso não representa controle de acesso seguro.