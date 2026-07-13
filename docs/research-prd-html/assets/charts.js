(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  function initChart(id) {
    var el = document.getElementById(id);
    if (!el || !window.echarts) return null;
    return echarts.init(el, null, { renderer: 'svg' });
  }

  function baseText() {
    return { color: muted, fontFamily: 'InstrumentSans, sans-serif' };
  }

  var market = initChart('chart-market-scale');
  if (market) {
    market.setOption({
      animation: false,
      tooltip: { trigger: 'axis', appendToBody: true },
      grid: { left: 70, right: 30, top: 28, bottom: 46 },
      xAxis: {
        type: 'category',
        data: ['城镇新增就业', '高校专项岗位', '年度招聘会岗位'],
        axisLabel: baseText(),
        axisLine: { lineStyle: { color: rule } },
        axisTick: { show: false }
      },
      yAxis: {
        type: 'value',
        name: '万人',
        nameTextStyle: baseText(),
        axisLabel: baseText(),
        splitLine: { lineStyle: { color: rule } }
      },
      series: [{
        type: 'bar',
        data: [1256, 476.8, 9000],
        barWidth: 42,
        itemStyle: {
          color: function(params) {
            return params.dataIndex === 2 ? accent2 : accent;
          },
          borderRadius: [8, 8, 0, 0]
        },
        label: {
          show: true,
          position: 'top',
          color: ink,
          formatter: function(p) { return p.value + '万'; }
        }
      }]
    });
    window.addEventListener('resize', function() { market.resize(); });
  }

  var dataSources = initChart('chart-data-sources');
  if (dataSources) {
    dataSources.setOption({
      animation: false,
      tooltip: { trigger: 'item', appendToBody: true },
      radar: {
        radius: '68%',
        indicator: [
          { name: '落地速度', max: 5 },
          { name: '合规安全', max: 5 },
          { name: '覆盖范围', max: 5 },
          { name: '数据质量', max: 5 },
          { name: '工程成本低', max: 5 }
        ],
        axisName: baseText(),
        splitLine: { lineStyle: { color: rule } },
        splitArea: { areaStyle: { color: [bg2, 'transparent'] } },
        axisLine: { lineStyle: { color: rule } }
      },
      legend: {
        bottom: 0,
        textStyle: baseText(),
        data: ['用户主动导入', '浏览器插件', '后台抓取']
      },
      color: [accent, accent2, muted],
      series: [{
        type: 'radar',
        data: [
          { value: [5, 5, 3, 4, 5], name: '用户主动导入', areaStyle: { opacity: 0.16 } },
          { value: [3, 4, 4, 4, 3], name: '浏览器插件', areaStyle: { opacity: 0.12 } },
          { value: [2, 1, 5, 3, 1], name: '后台抓取', areaStyle: { opacity: 0.08 } }
        ]
      }]
    });
    window.addEventListener('resize', function() { dataSources.resize(); });
  }
})();
