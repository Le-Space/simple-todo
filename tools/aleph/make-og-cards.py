#!/usr/bin/env python3
"""Generate the Simple-Todo social card, one per tutorial chapter.

Usage: python3 tools/aleph/make-og-cards.py <dir>; copy <dir>/<chapter>.jpg to
packages/brand/static/og/. Needs inkscape and ImageMagick (magick).

The mark is the Le-Space logo ("Der erste Knoten") lifted verbatim from
src/lib/LeSpaceLogo.svelte, with the CSS variables resolved to their brand
values because a social card is rendered by a crawler that has no stylesheet.
"""

import hashlib
import subprocess
import sys
from pathlib import Path

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else '.')

BG = '#0B0E15'
CORAL = '#FF6B5B'
CYAN = '#58C7F3'
INK = '#EDF1F8'
MUTED = '#8B95A7'

W, H = 1200, 630

# name -> (badge, one-line promise[, title, title size, stack line])
# A chapter that is shown to people outside the tutorial (escrow01, to a bank)
# gets a title of its own and says plainly that it runs on a testnet.
STACK = 'OrbitDB · IPFS · libp2p'
CHAPTERS = {
    'main': (None, 'No servers. No accounts. No passwords.'),
    'collab01': ('collab01', 'One list, shared between two browsers.'),
    'passkey01': ('passkey01', 'A passkey signs everything you write.'),
    'acl01': ('acl01', 'You decide who is allowed to write.'),
    'privacy01': ('privacy01', 'Sealed on the way in, opened only by you.'),
    'delegation01': ('delegation01', 'Hand one todo to someone, and take it back.'),
    'escrow01': ('escrow01 · Sepolia-Testnetz',
                 'Budget gesperrt, Betrag verschlüsselt, Freigabe per Passkey.',
                 'Vertrauliche Treuhand', 80, 'Zama FHE · ERC-7984 · EIP-7702'),
    'invoice01': ('invoice01', 'Invoices from your own todos, on your own device.'),
    'qr01': ('qr01', 'Hand a list over with a code. No internet.'),
}


def stars(seed: str) -> str:
    """Deterministic star field — same input, same picture, so a rebuild does
    not produce a gratuitously different file for git to store."""
    h = hashlib.sha256(seed.encode()).digest()
    out = []
    for i in range(46):
        x = h[(i * 3) % len(h)] / 255 * W
        y = h[(i * 3 + 1) % len(h)] / 255 * H
        r = 1.0 + (h[(i * 3 + 2) % len(h)] / 255) * 1.6
        o = 0.10 + (h[(i * 5 + 7) % len(h)] / 255) * 0.28
        # Not behind the text rows, where a star reads as a stray dot.
        if 300 < y < 580 and x < 1120:
            continue
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r:.2f}" fill="{INK}" opacity="{o:.2f}"/>')
    return '\n    '.join(out)


def mark(tx: float, ty: float, scale: float) -> str:
    """LeSpaceLogo.svelte, viewBox 0 0 96 96, variables resolved."""
    return f'''<g transform="translate({tx},{ty}) scale({scale})">
      <line x1="42.7" y1="49.96" x2="58.56" y2="34.94" stroke="{CYAN}" stroke-width="4" stroke-linecap="round"/>
      <line x1="47.43" y1="63.58" x2="62.8" y2="64.98" stroke="{CYAN}" stroke-width="4" stroke-linecap="round" stroke-dasharray="0.1 8"/>
      <line x1="69.85" y1="38.36" x2="72.41" y2="55.37" stroke="{CYAN}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="0.1 6" opacity="0.65"/>
      <circle cx="30" cy="62" r="15" fill="{CORAL}"/>
      <circle cx="68" cy="26" r="8" fill="none" stroke="{CYAN}" stroke-width="5"/>
      <circle cx="74" cy="66" r="6.5" fill="none" stroke="{CYAN}" stroke-width="4.5"/>
      <circle cx="17" cy="21" r="2.6" fill="{CYAN}" opacity="0.55"/>
    </g>'''


def badge(label: str, x: float, y: float) -> str:
    if not label:
        return ''
    # 21 px monospace with 1 px letter spacing: about 13.6 px a character, plus
    # the rounded ends. (19 px a character made long labels float in a box.)
    w = 44 + len(label) * 13.6
    return f'''<g>
      <rect x="{x}" y="{y}" rx="21" ry="21" width="{w}" height="42" fill="none" stroke="{CORAL}" stroke-width="2"/>
      <text x="{x + w / 2}" y="{y + 29}" text-anchor="middle" font-family="ui-monospace, Menlo, monospace"
            font-size="21" fill="{CORAL}" letter-spacing="1">{label}</text>
    </g>'''


def card(name: str) -> str:
    label, promise, *rest = CHAPTERS[name]
    title, size, stack = (rest + [None, None, None])[:3]
    heading = (f'{title}' if title
               else f'Simple<tspan fill="{CORAL}">-</tspan>Todo')
    size = size or 96
    stack = stack or STACK
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
  <defs>
    <radialGradient id="glow" cx="26%" cy="34%" r="62%">
      <stop offset="0%" stop-color="#16203A"/>
      <stop offset="100%" stop-color="{BG}"/>
    </radialGradient>
  </defs>
  <rect width="{W}" height="{H}" fill="{BG}"/>
  <rect width="{W}" height="{H}" fill="url(#glow)"/>
  <g>
    {stars(name)}
  </g>

  {mark(96, 132, 2.05)}

  <text x="112" y="392" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="{size}" font-weight="700" fill="{INK}" letter-spacing="-2">{heading}</text>

  <text x="116" y="452" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
        font-size="31" fill="{MUTED}">{promise}</text>

  {badge(label, 116, 496)}

  <text x="{W - 96}" y="{H - 62}" text-anchor="end" font-family="ui-monospace, Menlo, monospace"
        font-size="24" fill="{CYAN}" opacity="0.92">{stack}</text>

  <rect x="0" y="{H - 8}" width="{W}" height="8" fill="{CORAL}"/>
</svg>
'''


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name in CHAPTERS:
        svg_path = OUT / f'og-{name}.svg'
        png_path = OUT / f'og-{name}.png'
        svg_path.write_text(card(name))
        subprocess.run(
            ['inkscape', str(svg_path), '--export-type=png', f'--export-filename={png_path}',
             f'--export-width={W}', f'--export-height={H}'],
            check=True, capture_output=True,
        )
        # A JPEG of the same card is what the chapters serve: a tenth of the
        # PNG's size with no visible difference, and every chapter carries all
        # of them, because they share one assets folder (packages/brand/static).
        jpg_path = OUT / f'{name}.jpg'
        subprocess.run(
            ['magick', str(png_path), '-strip', '-quality', '88', '-sampling-factor', '4:2:0',
             str(jpg_path)],
            check=True, capture_output=True,
        )
        print(f'  {name:<12} {jpg_path.name}  {jpg_path.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
