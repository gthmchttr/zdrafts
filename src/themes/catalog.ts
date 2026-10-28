// Zola themes zdrafts can start a new site with: the getzola.org theme gallery's themes that
// build and edit in zdrafts (tests/theme-survey.test.ts), at the commit they were tested at.
// Themes on servers that don't let browsers download from them aren't listed.

export interface CatalogTheme {
  id: string;
  name: string;
  description: string;
  /** Repository on GitHub, Codeberg or GitLab */
  repo: string;
  /** The tested commit */
  commit: string;
  license: string;
  demo: string;
  screenshot: string;
}

export const CATALOG: CatalogTheme[] = [
  {
    "id": "abridge",
    "name": "abridge",
    "description": "A fast and lightweight Zola theme using semantic html, a class-light abridge.css, and No mandatory JS.",
    "repo": "https://github.com/jieiku/abridge",
    "commit": "3287153a19b07a410cc064732170fe275a45ea59",
    "license": "MIT",
    "demo": "https://abridge.pages.dev/",
    "screenshot": "https://www.getzola.org/themes/abridge/screenshot.png"
  },
  {
    "id": "apollo",
    "name": "apollo",
    "description": "Modern and minimalistic blog theme",
    "repo": "https://github.com/not-matthias/apollo",
    "commit": "31e30e27638aa68394d8625e5c49ad3b8310bf65",
    "license": "MIT",
    "demo": "https://not-matthias.github.io/apollo",
    "screenshot": "https://www.getzola.org/themes/apollo/screenshot.png"
  },
  {
    "id": "archie-zola",
    "name": "archie-zola",
    "description": "A zola theme based on Hugo archie.",
    "repo": "https://github.com/XXXMrG/archie-zola",
    "commit": "e9bfd022102b09486c84001ea39ff0a2cd7600a0",
    "license": "MIT",
    "demo": "https://archie-zola.netlify.app/",
    "screenshot": "https://www.getzola.org/themes/archie-zola/screenshot.png"
  },
  {
    "id": "austere",
    "name": "austere",
    "description": "A minimal theme for Zola with a focus on writing.",
    "repo": "https://github.com/tomwrw/austere-theme-zola",
    "commit": "701ac2dc65d6210ed4cfd3456a28f597d90665fa",
    "license": "MIT",
    "demo": "",
    "screenshot": "https://www.getzola.org/themes/austere/screenshot.png"
  },
  {
    "id": "bearblog",
    "name": "Bear",
    "description": "Bear blog theme",
    "repo": "https://codeberg.org/alinnow/zola-bearblog",
    "commit": "7699b6237032e4bd7a739d5920e74f5adcf837c4",
    "license": "MIT",
    "demo": "https://alinnow.codeberg.page/zola-bearblog/",
    "screenshot": "https://www.getzola.org/themes/bearblog/screenshot.png"
  },
  {
    "id": "devlab-theme",
    "name": "devlab-theme",
    "description": "A composable Zola theme for product sites, blogs, documentation and books.",
    "repo": "https://codeberg.org/RiPetitor/devlab-theme",
    "commit": "2b638831313058ba92d17095fce15454fda02eba",
    "license": "MIT",
    "demo": "https://ripetitor.codeberg.page/devlab-theme/",
    "screenshot": "https://www.getzola.org/themes/devlab-theme/screenshot.png"
  },
  {
    "id": "dose",
    "name": "dose",
    "description": "a small blog theme",
    "repo": "https://github.com/oltdaniel/dose",
    "commit": "c8793b83d11717c19fb355b58e12909ee9d9d0cb",
    "license": "MIT",
    "demo": "https://oltdaniel.github.io/dose",
    "screenshot": "https://www.getzola.org/themes/dose/screenshot.png"
  },
  {
    "id": "duckquill",
    "name": "Duckquill",
    "description": "Modern, pretty, and clean theme",
    "repo": "https://codeberg.org/daudix/duckquill",
    "commit": "5b0c3fca2481b4a074fc9b8cc2cffc649de9e182",
    "license": "MIT",
    "demo": "https://duckquill.daudix.one",
    "screenshot": "https://www.getzola.org/themes/duckquill/screenshot.png"
  },
  {
    "id": "kita",
    "name": "Kita",
    "description": "Kita is a clean, elegant and simple blog theme for Zola.",
    "repo": "https://github.com/st1020/kita",
    "commit": "46e497df4282d28e3e9d26f7687a6b8deb09e6d6",
    "license": "MIT",
    "demo": "https://kita-zola.pages.dev",
    "screenshot": "https://www.getzola.org/themes/kita/screenshot.png"
  },
  {
    "id": "linkita",
    "name": "Linkita",
    "description": "A clean and elegant blog theme for Zola. Linkita is based on Kita and Hugo-Paper and is multilingual and SEO friendly.",
    "repo": "https://github.com/salif/linkita",
    "commit": "25446ab67b046793a5eed30a2daae6dcc456fffc",
    "license": "MIT",
    "demo": "https://salif.github.io/linkita/",
    "screenshot": "https://www.getzola.org/themes/linkita/screenshot.png"
  },
  {
    "id": "matbook",
    "name": "MATbook",
    "description": "A zola chapter book theme inspired from book and olivine",
    "repo": "https://github.com/srliu3264/MATbook",
    "commit": "389ce0a31505c95e3d403217d90bf6a4f509bb41",
    "license": "MIT",
    "demo": "https://srliu3264.github.io/MATbook-live-demo/",
    "screenshot": "https://www.getzola.org/themes/matbook/screenshot.png"
  },
  {
    "id": "olivine",
    "name": "Olivine",
    "description": "A Zola theme for a personal knowledge base",
    "repo": "https://github.com/dongryul-kim/olivine",
    "commit": "4c045731ee845e1058a4deef313868c30319fa8e",
    "license": "MIT",
    "demo": "https://dongryul-kim.github.io/olivine/",
    "screenshot": "https://www.getzola.org/themes/olivine/screenshot.png"
  },
  {
    "id": "parchment",
    "name": "parchment",
    "description": "Parchment theme, by jasonfry.co.uk",
    "repo": "https://github.com/jsonfry/parchment",
    "commit": "01a34271cf00974118c4e57afefdbddb9de5e056",
    "license": "MIT",
    "demo": "https://whispers-on-parchment.jasonfry.co.uk",
    "screenshot": "https://www.getzola.org/themes/parchment/screenshot.png"
  },
  {
    "id": "persona",
    "name": "Persona",
    "description": "A portfolio, a resume, a blog, and a Zola theme.",
    "repo": "https://github.com/hanson-hschang/Persona-Zola-Theme",
    "commit": "415c3a3002bf02f41219845f94453e5dfe56bbf9",
    "license": "MIT",
    "demo": "https://hanson-hschang.github.io/Persona-Zola-Theme",
    "screenshot": "https://www.getzola.org/themes/persona/screenshot.png"
  },
  {
    "id": "photography-theme",
    "name": "photography theme",
    "description": "a photography portfolio theme with many features, including an AI blocker",
    "repo": "https://codeberg.org/arbs09/photography-theme",
    "commit": "a8d73f019ba7c8528ad3b644096ded05d13098ce",
    "license": "MIT",
    "demo": "https://simplesnap.de",
    "screenshot": "https://www.getzola.org/themes/photography-theme/screenshot.png"
  },
  {
    "id": "portio-zola",
    "name": "Portio-Zola",
    "description": "Portio-Zola is a minimal, well-formatted and extremely flexible theme",
    "repo": "https://github.com/quentin-rodriguez/portio-zola",
    "commit": "5875087966717184448c18430da8425e2f2f5d94",
    "license": "MIT",
    "demo": "https://quentin-rodriguez.github.io/portio-zola",
    "screenshot": "https://www.getzola.org/themes/portio-zola/screenshot.png"
  },
  {
    "id": "radion",
    "name": "radion",
    "description": "A sleek, modern blog theme.",
    "repo": "https://github.com/micahkepe/radion",
    "commit": "418e013f74c466a4074239e1eabd6f706f33d55f",
    "license": "MIT",
    "demo": "https://micahkepe.com/radion/",
    "screenshot": "https://www.getzola.org/themes/radion/screenshot.png"
  },
  {
    "id": "serene",
    "name": "serene",
    "description": "A minimal blog theme for zola, well crafted",
    "repo": "https://github.com/isunjn/serene",
    "commit": "96cbbbf79f27effd20e67562c06eecec6d605a6e",
    "license": "MIT",
    "demo": "https://serene-demo.pages.dev",
    "screenshot": "https://www.getzola.org/themes/serene/screenshot.png"
  },
  {
    "id": "simplepod",
    "name": "SimplePod",
    "description": "A simple podcast theme with an iTunes-compatible RSS feed, a built-in audio player, and client-side search. No build step required.",
    "repo": "https://github.com/cbrake/simplepod",
    "commit": "00938334d13a0b7d9dd998c00af05f32440ac477",
    "license": "MIT",
    "demo": "https://cbrake.github.io/simplepod/",
    "screenshot": "https://www.getzola.org/themes/simplepod/screenshot.png"
  },
  {
    "id": "still",
    "name": "still",
    "description": "A minimal Zola blog theme focused on reading and writing",
    "repo": "https://github.com/wjianbo/zola-theme-still",
    "commit": "8396636a1972500e147067c05640eed79b65ba5b",
    "license": "MIT",
    "demo": "https://wjianbo.github.io/zola-theme-still/",
    "screenshot": "https://www.getzola.org/themes/still/screenshot.png"
  },
  {
    "id": "tabi",
    "name": "tabi",
    "description": "tabi is an accessible Zola theme with search, multi-language support, optional JavaScript, a perfect Lighthouse score, and comprehensive documentation. Crafted for personal websites and blogs.",
    "repo": "https://github.com/welpo/tabi",
    "commit": "f0cb3a67ac1884377ca6f24bf8828e2dbd1bafd5",
    "license": "MIT",
    "demo": "https://welpo.github.io/tabi",
    "screenshot": "https://www.getzola.org/themes/tabi/screenshot.png"
  },
  {
    "id": "volks-typo",
    "name": "volks-typo",
    "description": "Minimalist blog theme with bold industrial typography and an 8-point grid (Zola port of the Astro Volks-Typo theme).",
    "repo": "https://gitlab.com/tisgoud/zola-volks-typo-theme",
    "commit": "6a748da2246bceae8cec91086e53d3a0a63ea88b",
    "license": "MIT",
    "demo": "https://tisgoud.gitlab.io/zola-volks-typo-theme/",
    "screenshot": "https://www.getzola.org/themes/volks-typo/screenshot.png"
  },
  {
    "id": "xuan",
    "name": "xuan",
    "description": "Modern, pretty, and clean theme",
    "repo": "https://github.com/jhq223/xuan",
    "commit": "3db97c9d986c23d05b8cac9cfa8d5a9f53e122c5",
    "license": "MIT",
    "demo": "https://xuan-theme.jhq223.workers.dev",
    "screenshot": "https://www.getzola.org/themes/xuan/screenshot.png"
  },
  {
    "id": "zallery",
    "name": "zallery",
    "description": "Gallery theme for zola",
    "repo": "https://github.com/gamingrobot/zallery",
    "commit": "3e2c30534a1f67eef79fd0bd1a19769d818049ac",
    "license": "MIT",
    "demo": "https://gamingrobot.github.io/zallery-demo",
    "screenshot": "https://www.getzola.org/themes/zallery/screenshot.png"
  },
  {
    "id": "zola-hacker",
    "name": "zola-hacker",
    "description": "Hacker is a theme for Zola",
    "repo": "https://github.com/en9inerd/zola-hacker",
    "commit": "456ce2cf5bd5652cb57c8977fc0ebfced600e5a4",
    "license": "MIT",
    "demo": "https://zola-hacker.enginerd.io/",
    "screenshot": "https://www.getzola.org/themes/zola-hacker/screenshot.png"
  },
  {
    "id": "zola-pickles",
    "name": "pickles",
    "description": "A modern, simple, clean blog theme for Zola.",
    "repo": "https://github.com/lukehsiao/zola-pickles",
    "commit": "0eae254773ff9f6a7cb4158257da49de2558960f",
    "license": "BlueOak-1.0.0",
    "demo": "https://zola-pickles.pages.dev/",
    "screenshot": "https://www.getzola.org/themes/zola-pickles/screenshot.png"
  },
  {
    "id": "zola-quiet",
    "name": "zola-quiet",
    "description": "A quiet, two-skin Zola theme: Minima-flavoured typography and a TUI/ncurses look with ASCII article frame. Both skins ship with matched light and dark modes plus a runtime toggle. Docs-style on-page TOC, addendum convention, iframe theme-sync protocol baked in.",
    "repo": "https://github.com/johnnybravo-xyz/zola-quiet",
    "commit": "54c7f2905ede6909057836952dc1dfddb0fb05c0",
    "license": "MIT",
    "demo": "",
    "screenshot": "https://www.getzola.org/themes/zola-quiet/screenshot.png"
  },
  {
    "id": "zola-theme-nivis",
    "name": "nivis",
    "description": "A clean zola theme for bloggers",
    "repo": "https://github.com/Resorie/zola-theme-nivis",
    "commit": "e898dba56947f7781ea235a76a101f5ce35c469f",
    "license": "MIT",
    "demo": "https://blog.resorie.xyz/",
    "screenshot": "https://www.getzola.org/themes/zola-theme-nivis/screenshot.png"
  },
  {
    "id": "zolanight",
    "name": "zolanight",
    "description": "ZolaNight is a dark theme inspired by the Tokyo Night color palette",
    "repo": "https://github.com/mxaddict/zolanight",
    "commit": "6be54bcaec636d15bda9c7290b16e7ab8d227dbb",
    "license": "MIT",
    "demo": "https://zolanight.codedmaster.com",
    "screenshot": "https://www.getzola.org/themes/zolanight/screenshot.png"
  },
  {
    "id": "zolarwind",
    "name": "Zolarwind",
    "description": "A GDPR-friendly Zola blog theme: no third-party requests, Tailwind CSS, KaTeX, Mermaid, localization",
    "repo": "https://github.com/thomasweitzel/zolarwind",
    "commit": "b793bc2bff6d31da193fcc8f337729db7e399a76",
    "license": "MIT",
    "demo": "https://weitzel.dev",
    "screenshot": "https://www.getzola.org/themes/zolarwind/screenshot.png"
  }
];
