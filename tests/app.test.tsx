import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';

describe('应用入口', () => {
  it('未配置云端时显示可理解的说明', async () => {
    render(<App />);
    expect(
      await screen.findByText('云端服务尚未配置。正式部署需要设置 Supabase 环境变量。'),
    ).toBeInTheDocument();
  });
});
