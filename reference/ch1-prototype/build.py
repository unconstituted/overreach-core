import base64, glob, os, json
d = os.path.dirname(os.path.abspath(__file__))
b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()
clips = {os.path.basename(f)[:-4]: b64(f) for f in sorted(glob.glob(d + '/clips/*.mp3'))}
imgs = {os.path.basename(f)[:-4]: 'data:image/jpeg;base64,' + b64(f) for f in sorted(glob.glob(d + '/img/*.jpg'))}
assets = 'const CLIPS=' + json.dumps(clips) + ';\nconst IMG=' + json.dumps(imgs) + ';\n'
three = open(d + '/package/build/three.min.js').read()
js = ''.join(open(d + '/' + f).read() + '\n' for f in ['a_core.js', 'b_world.js', 'c_audio.js', 'd_main.js'])
page = open(d + '/page.html').read()
body = page + '\n<script>' + three.replace('</script', '<\\/script') + '</script>\n<script>' + assets + '</script>\n<script>' + js + '</script>\n'
os.makedirs(d + '/out', exist_ok=True)
open(d + '/out/artifact.html', 'w').write(body)
open(d + '/out/Overreach-Ch1-Ride.html', 'w').write('<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head><body>\n' + body + '</body></html>\n')
print(os.path.getsize(d + '/out/artifact.html') / 1e6, 'MB')
