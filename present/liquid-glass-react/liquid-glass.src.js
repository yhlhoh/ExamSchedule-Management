import React, { Fragment, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import LiquidGlass from 'liquid-glass-react';

const appRoot = document.getElementById('app');

const formatTime = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }
  return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
};

const safeConfigId = () => {
  const query = new URLSearchParams(window.location.search);
  const configId = query.get('configId') || '';
  if (!configId) {
    return null;
  }
  return /^[a-zA-Z0-9_-]+$/.test(configId) ? configId : '__INVALID__';
};

const createDemoSchedule = () => {
  const now = Date.now();
  const start = new Date(now + 5 * 60 * 1000);
  return {
    examName: '演示考试安排',
    room: 'A101',
    message: '请将手机调为静音并独立完成考试。',
    examInfos: [
      { id: 'demo-1', name: '语文', start, end: new Date(start.getTime() + 120 * 60 * 1000) },
      {
        id: 'demo-2',
        name: '数学',
        start: new Date(start.getTime() + 180 * 60 * 1000),
        end: new Date(start.getTime() + 300 * 60 * 1000)
      }
    ]
  };
};

const normalizeSchedule = (raw) => {
  const examInfos = Array.isArray(raw?.examInfos) ? raw.examInfos : [];
  return {
    examName: raw?.examName || '考试安排',
    room: raw?.room || '',
    message: raw?.message || '',
    examInfos: examInfos
      .map((item, index) => {
        const start = new Date(item.start);
        const end = new Date(item.end);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
          return null;
        }
        return {
          id: item.id ?? index,
          name: item.name || '未命名科目',
          start,
          end
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start)
  };
};

const isLowPerformanceMode = () => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const limitedCpu = Number.isFinite(navigator.hardwareConcurrency) && navigator.hardwareConcurrency <= 4;
  return reduced || limitedCpu;
};

const demoMode = new URLSearchParams(window.location.search).get('demo') === '1';

const glassBaseProps = isLowPerformanceMode()
  ? { blurAmount: 0.045, displacementScale: 36, elasticity: 0, saturation: 130 }
  : { blurAmount: 0.082, displacementScale: 58, elasticity: 0.18, saturation: 142 };

function getExamStatus(exam, now) {
  if (now < exam.start) return '待开始';
  if (now >= exam.start && now <= exam.end) return '进行中';
  return '已结束';
}

function App() {
  const [now, setNow] = useState(new Date());
  const [data, setData] = useState({ examName: '加载中...', room: '', message: '', examInfos: [] });
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const configId = safeConfigId();
    if (configId === '__INVALID__') {
      setError('配置ID格式错误');
      return;
    }
    if (!configId && !demoMode) {
      setError('缺少 configId 参数。示例：/present/liquid-glass.html?configId=xxx');
      return;
    }

    if (demoMode) {
      setData(normalizeSchedule(createDemoSchedule()));
      return;
    }

    fetch(`/api/get_config.php?id=${encodeURIComponent(configId)}`)
      .then(async (response) => {
        if (!response.ok) {
          let msg = '读取配置失败';
          try {
            const payload = await response.json();
            if (payload?.message) {
              msg = payload.message;
            }
          } catch (_err) {
            // noop
          }
          throw new Error(msg);
        }
        return response.json();
      })
      .then((payload) => {
        setData(normalizeSchedule(payload));
        setError('');
      })
      .catch((err) => setError(err.message || '读取配置失败'));
  }, []);

  const current = data.examInfos.find((exam) => now >= exam.start && now <= exam.end) || null;
  const next = data.examInfos.find((exam) => now < exam.start) || null;

  return React.createElement(
    'main',
    { className: 'layout' },
    React.createElement(
      'section',
      { className: 'header-row' },
      React.createElement(
        LiquidGlass,
        { ...glassBaseProps, cornerRadius: 30, padding: '20px 24px' },
        React.createElement('h1', { className: 'title' }, `${data.examName}${data.room ? ` · ${data.room}` : ''}`),
        React.createElement('p', { className: 'subtitle' }, data.message || '祝各位同学考试顺利')
      ),
      React.createElement(
        LiquidGlass,
        { ...glassBaseProps, cornerRadius: 30, padding: '20px 24px', overLight: true },
        React.createElement('p', { className: 'clock', 'aria-label': '当前时间' }, formatTime(now)),
        React.createElement('a', { className: 'back-link', href: `/present/index.html${window.location.search}` }, '返回默认放映页')
      )
    ),
    error
      ? React.createElement(
          LiquidGlass,
          { ...glassBaseProps, cornerRadius: 24, padding: '16px 20px' },
          React.createElement('div', { className: 'error-text' }, `加载失败：${error}`)
        )
      : null,
    React.createElement(
      'section',
      { className: 'content-grid' },
      React.createElement(
        LiquidGlass,
        { ...glassBaseProps, cornerRadius: 24, padding: '18px 22px', className: 'next-item' },
        React.createElement('h2', { className: 'section-title' }, current ? '当前考试' : '下一场考试'),
        next || current
          ? React.createElement(
              Fragment,
              null,
              React.createElement('p', { className: 'next-name' }, (current || next).name),
              React.createElement('p', { className: 'meta' }, `${formatTime((current || next).start)} - ${formatTime((current || next).end)}`),
              current
                ? React.createElement('span', { className: 'status-pill live' }, '进行中')
                : React.createElement('span', { className: 'status-pill' }, '待开始')
            )
          : React.createElement('p', { className: 'meta' }, '当前没有考试安排')
      ),
      React.createElement(
        LiquidGlass,
        { ...glassBaseProps, cornerRadius: 24, padding: '18px 22px', className: 'table-wrap' },
        React.createElement('h2', { className: 'section-title' }, '考试列表'),
        data.examInfos.length === 0
          ? React.createElement('p', { className: 'empty-state' }, '暂无可显示的考试数据')
          : React.createElement(
              'table',
              { className: 'table' },
              React.createElement(
                'thead',
                null,
                React.createElement(
                  'tr',
                  null,
                  React.createElement('th', null, '科目'),
                  React.createElement('th', null, '开始'),
                  React.createElement('th', null, '结束'),
                  React.createElement('th', null, '状态')
                )
              ),
              React.createElement(
                'tbody',
                null,
                ...data.examInfos.map((exam) =>
                  React.createElement(
                    'tr',
                    { key: String(exam.id) },
                    React.createElement('td', null, exam.name),
                    React.createElement('td', null, formatTime(exam.start)),
                    React.createElement('td', null, formatTime(exam.end)),
                    React.createElement(
                      'td',
                      null,
                      React.createElement(
                        'span',
                        { className: `status-pill ${getExamStatus(exam, now) === '进行中' ? 'live' : ''}` },
                        getExamStatus(exam, now)
                      )
                    )
                  )
                )
              )
            )
      )
    )
  );
}

createRoot(appRoot).render(React.createElement(App));
