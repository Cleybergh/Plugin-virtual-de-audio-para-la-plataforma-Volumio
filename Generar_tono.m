fs = 48000;
t  = (0:2*fs-1)'/fs;          % 2 segundos
x  = 0.4*sin(2*pi*220*t);     % tono de 220 Hz, amplitud 0,4
audiowrite('tono220.wav', x, fs);