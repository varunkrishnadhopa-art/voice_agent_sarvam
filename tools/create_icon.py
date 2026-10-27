from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
root=Path(__file__).resolve().parents[1]
image=Image.new('RGBA',(256,256),(0,0,0,0))
draw=ImageDraw.Draw(image)
draw.rounded_rectangle((8,8,248,248),radius=64,fill='#b7a2ff')
font=ImageFont.truetype('C:/Windows/Fonts/georgia.ttf',220)
box=draw.textbbox((0,0),'s',font=font)
draw.text(((256-(box[2]-box[0]))/2-box[0],(256-(box[3]-box[1]))/2-box[1]-8),
          's',font=font,fill='#201831')
(root/'assets').mkdir(exist_ok=True)
image.save(root/'app/icon.png')
image.save(root/'assets/icon.ico',sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
