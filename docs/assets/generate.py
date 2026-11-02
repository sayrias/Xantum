from pathlib import Path
from xml.etree import ElementTree as ET
import subprocess
import copy
import html
import tempfile

out = Path(__file__).resolve().parent
SVG = 'http://www.w3.org/2000/svg'
XLINK = 'http://www.w3.org/1999/xlink'
ET.register_namespace('', SVG)
ET.register_namespace('xlink', XLINK)

def outline(text, size, weight, x, y, fill):
    tmp_file = tempfile.NamedTemporaryFile(suffix='.svg')
    tmp = Path(tmp_file.name)
    subprocess.run(['pango-view', '--no-display', '--pixels', '--margin=0', '--background=transparent', f'--font=Montserrat {weight} {size}', '--foreground='+fill, '--text='+text, '--output='+str(tmp)], check=True)
    root = ET.parse(tmp).getroot()
    tmp_file.close()
    glyphs = {n.attrib['id']: n for n in root.iter() if 'id' in n.attrib}
    g = ET.Element('g', {'transform': f'translate({x} {y})', 'fill': fill, 'aria-hidden': 'true'})
    for use in root.iter('{'+SVG+'}use'):
        group = ET.SubElement(g, 'g', {'transform': 'translate('+use.attrib.get('x','0')+' '+use.attrib.get('y','0')+')'})
        ref = use.attrib.get('{'+XLINK+'}href', use.attrib.get('href',''))[1:]
        for child in glyphs[ref]:
            group.append(copy.deepcopy(child))
    return ET.tostring(g, encoding='unicode')

def save(name, width, height, title, desc, body):
    content = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">\n<title id="title">{html.escape(title)}</title>\n<desc id="desc">{html.escape(desc)}</desc>\n{body}\n</svg>\n'''
    (out/name).write_text(content)

hero = '''<rect x="1" y="1" width="1278" height="398" rx="24" fill="#070b14" stroke="#263449" stroke-width="2"/>
<path d="M758 1h497a24 24 0 0 1 24 24v350a24 24 0 0 1-24 24H654Z" fill="#0d1526"/>
<path d="M738 42h454M698 357h494" fill="none" stroke="#25344c" stroke-width="1"/>
<g transform="translate(64 63)" fill="none" stroke="#3ecfcf" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
<path d="M28 0 52 11v21c0 14-10 25-24 31C14 57 4 46 4 32V11Z"/>
<path d="m17 22 21 23m0-23L17 45"/>
</g>'''
hero += outline('Xantum', 82, 'SemiBold', 140, 40, '#f0f4ff')
hero += outline('Kendi sunucun.', 40, 'Medium', 64, 154, '#f0f4ff')
hero += outline('Kendi bağlantın.', 40, 'Medium', 64, 204, '#f0f4ff')
hero += '''<g font-family="Inter, Noto Sans, sans-serif" font-size="18" fill="#b4c3d7">
<text x="66" y="306">Windows + Linux</text><circle cx="263" cy="300" r="3" fill="#3ecfcf"/><text x="281" y="306">XTP altyapısı</text>
<text x="66" y="356" font-size="16" fill="#a7a0ff">v1.0.0 hazırlanıyor</text>
</g>
<g fill="none" stroke-linecap="round" stroke-linejoin="round">
<path d="M790 274 850 274 950 122 1054 122 1150 274 1212 274" stroke="#23354e" stroke-width="22"/>
<path d="M790 122 850 122 950 274 1054 274 1150 122 1212 122" stroke="#23354e" stroke-width="22"/>
<path d="M790 274 850 274 950 122 1054 122 1150 274 1212 274" stroke="#3ecfcf" stroke-width="4"/>
<path d="M790 122 850 122 950 274 1054 274 1150 122 1212 122" stroke="#8c83ff" stroke-width="4"/>
<path d="M994 172 1010 172a8 8 0 0 1 8 8v36a8 8 0 0 1-8 8h-16a8 8 0 0 1-8-8v-36a8 8 0 0 1 8-8Z" fill="#0d1526" stroke="#60758f" stroke-width="2"/>
<path d="M996 185h12m-12 10h12m-12 10h5" stroke="#b4c3d7" stroke-width="2"/>
<path d="m897 188 10-15m192 28 10 15m-289-94h20m322 152h20" stroke="#f0f4ff" stroke-width="7"/>
</g>
<g font-family="Inter, Noto Sans, sans-serif" font-size="13" fill="#b4c3d7" letter-spacing="1.2"><text x="790" y="77">MASAÜSTÜ</text><text x="982" y="327">XTP</text><text x="1130" y="77">SUNUCUN</text></g>'''
save('xantum-banner.svg',1280,400,'Xantum — Kendi sunucun. Kendi bağlantın.','Windows ve Linux için XTP altyapısı. v1.0.0 hazırlanıyor. Turkuaz ve mor bağlantı yolları masaüstü istemcisi ile kendi sunucunu birleştiriyor.',hero)

icons = {
'install': '<path d="M14 2v20m-8-8 8 8 8-8M3 25v6h22v-6"/>',
'wiki': '<path d="M14 7c-4-4-9-4-13-2v24c4-2 9-2 13 2 4-4 9-4 13-2V5c-4-2-9-2-13 2Zm0 0v24"/>',
'releases': '<path d="m14 2 13 7v16l-13 7L1 25V9Zm0 14L1 9m13 7 13-7m-13 7v16M7 5l14 8"/>',
'issues': '<path d="M28 14a13 13 0 0 1-13 13H8l-7 5V14A13 13 0 0 1 28 14Z"/><path d="M15 7v9m0 5h.1"/>'
}
buttons = [('install','Kurulum','#3ecfcf','#07151e'),('wiki','Wiki','#6c63ff','#ffffff'),('releases','Sürümler','#101b2e','#f0f4ff'),('issues','Hata / Öneri','#101b2e','#f0f4ff')]
for name,label,bg,fg in buttons:
    body = f'<rect x="1" y="1" width="350" height="102" rx="14" fill="{bg}" stroke="'+('#2e405b' if name in ['releases','issues'] else bg)+'" stroke-width="2"/>'
    body += f'<g transform="translate(28 36)" fill="none" stroke="{fg}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">{icons[name]}</g>'
    body += outline(label,28,'SemiBold',80,34,fg)
    body += f'<path d="M307 44l8 8-8 8m-9-8h17" stroke="{fg}" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
    save('button-'+name+'.svg',352,104,label,label+' sayfasını aç.',body)

# Deliberately a schematic: no screenshots or unverified connection values.
body = '''<rect x="1" y="1" width="1278" height="254" rx="20" fill="#0d1526" stroke="#263449" stroke-width="2"/>
<g fill="none" stroke="#3ecfcf" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M370 128h150m-11-8 11 8-11 8M838 128h148m-11-8 11 8-11 8"/></g>
<g fill="#16243a"><rect x="56" y="70" width="312" height="116" rx="12"/><rect x="522" y="70" width="314" height="116" rx="12"/><rect x="988" y="70" width="236" height="116" rx="12"/></g>
<g font-family="Inter, Noto Sans, sans-serif" text-anchor="middle" fill="#f0f4ff" font-size="25" font-weight="600"><text x="212" y="119">Masaüstü istemcisi</text><text x="679" y="119">Kendi Linux sunucun</text><text x="1106" y="119">İnternet</text></g>
<g font-family="Inter, Noto Sans, sans-serif" text-anchor="middle" fill="#b4c3d7" font-size="18"><text x="212" y="151">Windows / Linux</text><text x="679" y="151">XTP + TUN + IPv4 NAT</text><text x="1106" y="151">Hedef servis</text><text x="445" y="99" fill="#3ecfcf">TLS / WSS</text><text x="912" y="99">Çıkış</text><text x="640" y="225" font-size="16">Şema, mimariyi gösterir. Gerçek koruma kapsamı yayın kontrol belgesinde izlenir.</text></g>'''
save('xtp-flow.svg',1280,256,'XTP bağlantı akışı','Windows veya Linux istemcisi TLS ve WSS üzerinden kendi Linux sunucuna bağlanır. Sunucu TUN ve IPv4 NAT üzerinden internete çıkış sağlar. Şema gerçek cihaz testinin yerini tutmaz.',body)

compact = '<rect x="1" y="1" width="638" height="538" rx="24" fill="#070b14" stroke="#263449" stroke-width="2"/>'
compact += '<g transform="translate(44 45)" fill="none" stroke="#3ecfcf" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M25 0 48 11v20c0 13-9 23-23 29C11 54 2 44 2 31V11Z"/><path d="m15 21 20 22m0-22L15 43"/></g>'
compact += outline('Xantum', 72, 'SemiBold', 112, 24, '#f0f4ff')
compact += outline('Kendi sunucun.', 40, 'Medium', 44, 134, '#f0f4ff')
compact += outline('Kendi bağlantın.', 40, 'Medium', 44, 184, '#f0f4ff')
compact += '<g font-family="Inter, Noto Sans, sans-serif" font-size="21" fill="#b4c3d7"><text x="46" y="282">Windows + Linux</text><circle cx="265" cy="274" r="3" fill="#3ecfcf"/><text x="284" y="282">XTP altyapısı</text><text x="46" y="326" font-size="20" fill="#a7a0ff">v1.0.0 hazırlanıyor</text></g>'
compact += '<path d="M44 355h552" stroke="#25344c"/><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M46 402h98l106 92h138l106-92h100M46 494h98l106-92h138l106 92h100" stroke="#23354e" stroke-width="18"/><path d="M46 402h98l106 92h138l106-92h100" stroke="#8c83ff" stroke-width="4"/><path d="M46 494h98l106-92h138l106 92h100" stroke="#3ecfcf" stroke-width="4"/><path d="M97 402h18m294 74 14-12m-183-53 14 12m283 71h18" stroke="#f0f4ff" stroke-width="6"/></g>'
save('xantum-banner-compact.svg',640,540,'Xantum — Kendi sunucun. Kendi bağlantın.','Windows ve Linux için XTP altyapısı. v1.0.0 hazırlanıyor.',compact)

flow_compact = '<rect x="1" y="1" width="638" height="718" rx="20" fill="#0d1526" stroke="#263449" stroke-width="2"/>'
flow_compact += '<g fill="#16243a"><rect x="44" y="40" width="552" height="132" rx="12"/><rect x="44" y="284" width="552" height="132" rx="12"/><rect x="44" y="528" width="552" height="132" rx="12"/></g>'
flow_compact += '<g font-family="Inter, Noto Sans, sans-serif" text-anchor="middle" fill="#f0f4ff" font-size="30" font-weight="600"><text x="320" y="97">Masaüstü istemcisi</text><text x="320" y="341">Kendi Linux sunucun</text><text x="320" y="585">İnternet</text></g>'
flow_compact += '<g font-family="Inter, Noto Sans, sans-serif" text-anchor="middle" fill="#b4c3d7" font-size="23"><text x="320" y="136">Windows / Linux</text><text x="320" y="380">XTP + TUN + IPv4 NAT</text><text x="320" y="624">Hedef servis</text><text x="425" y="236" fill="#3ecfcf">TLS / WSS</text><text x="397" y="480">Çıkış</text><text x="320" y="700" font-size="21">Mimari şema · Test kanıtı değildir</text></g>'
flow_compact += '<g fill="none" stroke="#3ecfcf" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M320 194v68m-10-11 10 11 10-11M320 438v68m-10-11 10 11 10-11"/></g>'
save('xtp-flow-compact.svg',640,720,'XTP bağlantı akışı','Windows veya Linux istemcisi TLS ve WSS üzerinden kendi Linux sunucuna bağlanır. Sunucu TUN ve IPv4 NAT üzerinden internete çıkış sağlar. Mimari şemadır; gerçek cihaz testinin yerini tutmaz.',flow_compact)
