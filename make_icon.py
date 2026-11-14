from PIL import Image, ImageDraw, ImageFilter, ImageChops
import math
S=1024
def lerp(a,b,t): t=max(0,min(1,t)); return tuple(int(a[i]+(b[i]-a[i])*t) for i in range(len(a)))
# tile
grad=Image.new('RGBA',(S,S)); gp=grad.load()
for y in range(S):
    for x in range(S):
        gp[x,y]=lerp((44,47,56),(15,16,20),(x*0.3+y*0.7)/S)+(255,)
mask=Image.new('L',(S,S),0); ImageDraw.Draw(mask).rounded_rectangle([20,20,S-20,S-20],radius=230,fill=255)
img=Image.new('RGBA',(S,S),(0,0,0,0)); img.paste(grad,(0,0),mask)
rim=Image.new('RGBA',(S,S),(0,0,0,0)); ImageDraw.Draw(rim).rounded_rectangle([20,20,S-20,S-20],radius=230,outline=(255,255,255,38),width=6)
img=Image.alpha_composite(img,rim)

# ball geometry (horizontal), rotated later
cx,cy=S//2,S//2+30; W,H=800,500
def outline(sx=1.0,sy=1.0):
    pts=[]
    for i in range(0,360):
        t=math.radians(i); c=math.cos(t); s=math.sin(t)
        y=s*H/2*sy*(1-0.10*abs(c)**3)          # blunt, egg-like ends
        pts.append((cx+c*W/2*sx, cy+y))
    return pts
L=Image.new('RGBA',(S,S),(0,0,0,0))
bm=Image.new('L',(S,S),0); ImageDraw.Draw(bm).polygon(outline(),fill=255)
# shaded white ball: radial-ish shading
ball=Image.new('RGBA',(S,S)); bp=ball.load()
for y in range(cy-H//2-4,cy+H//2+4):
    for x in range(cx-W//2-4,cx+W//2+4):
        dx=(x-cx)/(W/2); dy=(y-cy)/(H/2)
        r=min(1,(dx*dx*0.6+(dy+0.35)**2*0.9))
        bp[x,y]=lerp((255,255,255),(170,176,190),r**1.2)+(255,)
L.paste(ball,(0,0),bm)
# colour band (red + gold) across the middle, following the curve
band=Image.new('RGBA',(S,S),(0,0,0,0)); bd=ImageDraw.Draw(band)
def vband(x0,x1,col):
    poly=[]
    for k in range(0,41):
        y=cy-H/2+H*k/40; dy=(y-cy)/(H/2); off=60*(1-dy*dy)   # bulge so it wraps round the ball
        poly.append((x0+off,y))
    for k in range(40,-1,-1):
        y=cy-H/2+H*k/40; dy=(y-cy)/(H/2); off=60*(1-dy*dy)
        poly.append((x1+off,y))
    bd.polygon(poly,fill=col)
vband(cx-150,cx-75,(200,30,40,255)); vband(cx-60,cx+15,(242,181,68,255)); vband(cx+30,cx+105,(200,30,40,255))
band=Image.composite(band,Image.new('RGBA',(S,S),(0,0,0,0)),bm)
# re-apply shading to band
shade=Image.new('L',(S,S)); sp=shade.load()
for y in range(cy-H//2-4,cy+H//2+4):
    for x in range(cx-W//2-4,cx+W//2+4):
        dy=(y-cy)/(H/2); sp[x,y]=int(255*max(0,min(1,(dy+0.35)**2*0.55)))
dark=Image.new('RGBA',(S,S),(30,20,30,255)); dark.putalpha(Image.composite(shade,Image.new('L',(S,S),0),band.split()[3]))
L=Image.alpha_composite(L,band); L=Image.alpha_composite(L,dark)
# seams: 4-panel lines end to end
d=ImageDraw.Draw(L)
for k in (-1,1):
    seam=[(cx+math.cos(math.radians(i))*W/2*0.97, cy+k*math.sin(math.radians(i))*H/2*0.48) for i in range(0,181,3)]
    d.line(seam,fill=(120,126,140,200),width=7,joint='curve')
# outline
d.line(outline()+[outline()[0]],fill=(110,116,130,255),width=6,joint='curve')
# glossy highlight
hl=Image.new('RGBA',(S,S),(0,0,0,0)); ImageDraw.Draw(hl).ellipse([cx-300,cy-215,cx+80,cy-120],fill=(255,255,255,150))
hl=hl.filter(ImageFilter.GaussianBlur(22)); hl=Image.composite(hl,Image.new('RGBA',(S,S),(0,0,0,0)),bm)
L=Image.alpha_composite(L,hl)
L=L.rotate(28,resample=Image.BICUBIC,center=(cx,cy))
sh=Image.new('RGBA',(S,S),(0,0,0,255)); sh.putalpha(L.split()[3].filter(ImageFilter.GaussianBlur(28)).point(lambda v:int(v*0.6)))
img=Image.alpha_composite(img,ImageChops.offset(sh,16,30)); img=Image.alpha_composite(img,L)
# sparkles (gold glow + white core)
def star(dr,x,y,r,col):
    pts=[]
    for i in range(8):
        a=math.pi/4*i-math.pi/2; rr=r if i%2==0 else r*0.2
        pts.append((x+math.cos(a)*rr,y+math.sin(a)*rr))
    dr.polygon(pts,fill=col)
g=Image.new('RGBA',(S,S),(0,0,0,0)); gd=ImageDraw.Draw(g)
star(gd,790,215,165,(242,181,68,255)); star(gd,905,395,70,(242,181,68,255))
img=Image.alpha_composite(img,g.filter(ImageFilter.GaussianBlur(26)))
st=Image.new('RGBA',(S,S),(0,0,0,0)); sd=ImageDraw.Draw(st)
star(sd,790,215,145,(255,244,214,255)); star(sd,905,395,58,(255,244,214,255))
img=Image.alpha_composite(img,st)
img.save('icon_1024.png'); img.resize((256,256),Image.LANCZOS).save('icon_256.png')
img.resize((64,64),Image.LANCZOS).save('favicon_64.png')
img.save('app.ico',sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
sheet=Image.new('RGBA',(760,300),(240,240,240,255)); x=20
for sz in (256,128,64,48,32,16):
    sheet.alpha_composite(img.resize((sz,sz),Image.LANCZOS),(x,20)); x+=sz+20
dk=Image.new('RGBA',(760,140),(32,32,32,255)); x=20
for sz in (64,48,32,24,16):
    dk.alpha_composite(img.resize((sz,sz),Image.LANCZOS),(x,30)); x+=sz+30
sheet.alpha_composite(dk,(0,160)); sheet.save('preview.png')
