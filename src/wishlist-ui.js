const text = (value, size = 'sm', color = '#333333') => ({ type: 'text', text: value, size, color, wrap: true });
const action = (label, command) => ({ type: 'postback', label, data: `wish:${command}` });
const button = (label, command) => ({ type: 'button', height: 'sm', style: 'link', color: '#BC2436', action: action(label, command) });
export const wishQuickReply = () => ({ items: [
  ['許願板', '許願板'], ['我的許願', '我的許願'], ['新增許願', '新增'], ['查型號', '查詢']
].map(([label, cmd]) => ({ type: 'action', action: action(label, cmd) })) });

// Only this narrow allowlist can enter the wishlist handler through a button.
export function wishPostback(data) {
  if (typeof data !== 'string' || data.length > 180 || !data.startsWith('wish:')) return null;
  const command = data.slice(5);
  return /^(?:新增|查詢|(?:確認取消|取消許願) [A-Z]{1,8}-\d{1,4}(?:-\d{1,3})?|(?:許願板|我的許願)(?: [A-Z]{1,8}-\d{1,4}(?:-\d{1,3})?)?(?: 第\d{1,5}頁)?)$/.test(command) ? command : null;
}

export function wishCards(rows, { mine = false, model = null, total = 0, page = 1, pages = 1 } = {}) {
  const bubbles = [];
  for (let offset = 0; offset < Math.max(1, rows.length); offset += 5) {
    const contents = rows.slice(offset, offset + 5).flatMap((r, index) => [
      ...(index ? [{ type: 'separator', margin: 'md', color: '#E7E3DF' }] : []),
      { type: 'box', layout: 'vertical', margin: 'md', spacing: 'xs', contents: [
        { ...text(r.model, 'lg', '#151515'), weight: 'bold' },
        text(`${r.display_name}  ·  想要 1 顆`),
        mine ? button('我已取得／取消', `確認取消 ${r.model}`) : button('查看此型號需求', `許願板 ${r.model}`)
      ] }
    ]);
    if (!contents.length) contents.push(text('還沒有許願，成為第一位登記的成員吧。', 'md'));
    bubbles.push({ type: 'bubble', size: 'mega', header: { type: 'box', layout: 'vertical', backgroundColor: '#151515', spacing: 'sm', contents: [
      text('KAI 9.81  /  WISH BOARD', 'xs', '#E77580'),
      { ...text(mine ? '我的許願' : '戰隊許願板', 'xl', '#FFFFFF'), weight: 'bold' },
      text(`${model || '本群組限定'} · ${total} 筆 · 第 ${page}/${pages} 頁`, 'xs', '#CCCCCC')
    ] }, body: { type: 'box', layout: 'vertical', backgroundColor: '#FAF8F5', contents },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      text('稱呼由成員自填，有多買可在群內聯繫。', 'xs', '#777777'),
      button('新增許願', '新增'), button(mine ? '查看全群需求' : '管理我的許願', mine ? '許願板' : '我的許願'),
      ...(page > 1 ? [button('上一頁', `${mine ? '我的許願' : '許願板'}${model ? ` ${model}` : ''} 第${page - 1}頁`)] : []),
      ...(page < pages ? [button('下一頁', `${mine ? '我的許願' : '許願板'}${model ? ` ${model}` : ''} 第${page + 1}頁`)] : [])
    ] } });
  }
  return [{ type: 'flex', altText: `${mine ? '我的許願' : '戰隊許願板'}｜${total} 筆需求｜第 ${page} 頁`, contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles }, quickReply: wishQuickReply() }];
}

export function wishCancelConfirmation(model) {
  return [{ type: 'template', altText: `取消自己的 ${model} 許願？`, template: { type: 'confirm', text: `確定取消你在本群組的 ${model} 許願？只會處理按下確認者自己的紀錄。`, actions: [action('確定取消', `取消許願 ${model}`), action('保留', '我的許願')] } }];
}
