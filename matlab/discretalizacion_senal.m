%% Figura: muestreo y regla del trapecio
Ts = 1/8; f = 1;
t  = 0:0.001:1;   x  = sin(2*pi*f*t);
n  = 0:Ts:1;      xn = sin(2*pi*f*n);

az = [0 0.2 0.6]; gr = [0.6 0.6 0.6];
fig = figure('Color','w','Units','centimeters','Position',[2 2 18 7]);
tiledlayout(1,2,'TileSpacing','compact','Padding','compact');

%% (a) Señal continua y sus muestras
nexttile
plot(t,x,'-','LineWidth',1.1,'Color',gr); hold on
stem(n,xn,'filled','LineWidth',1,'Color',az,'MarkerSize',4);
yline(0,'-','Color',[0.85 0.85 0.85]);
y0 = -1.12;
plot([n(1) n(2)],[y0 y0],'k-','LineWidth',0.8)
plot([n(1) n(1)],y0+[-.05 .05],'k-','LineWidth',0.8)
plot([n(2) n(2)],y0+[-.05 .05],'k-','LineWidth',0.8)
text(mean(n(1:2)),y0+0.17,'T_s','HorizontalAlignment','center')
xlabel('t'); ylabel('v(t)'); title('(a) Señal continua y sus muestras')
axis([0 1 -1.3 1.3]); box off

%% (b) Regla del trapecio sobre un intervalo
nexttile
ta = 0.30; tb = ta+Ts;
ia = sin(2*pi*f*ta); ib = sin(2*pi*f*tb);
tz = ta-0.06:0.001:tb+0.06; iz = sin(2*pi*f*tz);

patch([ta tb tb ta],[0 0 ib ia],[0.86 0.90 0.97],'EdgeColor',az,'LineWidth',1); hold on
plot(tz,iz,'-','LineWidth',1.1,'Color',gr);
plot([ta tb],[ia ib],'o','MarkerFaceColor',az,'MarkerEdgeColor',az,'MarkerSize',4);
text(ta,ia+0.07,'i_C[n-1]','HorizontalAlignment','center')
text(tb,ib+0.07,'i_C[n]','HorizontalAlignment','center')
xlabel('t'); ylabel('i_C(t)'); title('(b) Aproximación por la regla del trapecio')
xticks([ta tb]); xticklabels({'t_{n-1}','t_n'})
axis([ta-0.06 tb+0.06 0 1.2]); box off

exportgraphics(fig,'fig_trapecio.pdf','ContentType','vector')