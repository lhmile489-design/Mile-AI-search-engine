
import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";

// 每个屏幕外包一层：单个组件抛错时只替换该屏幕，不让整页白屏（PRODUCT.md §9）。

type Props = Readonly<{
  /** 屏幕名，用在提示文案里 */
  screen: string;
  /** 点「返回首页」时执行（通常是 newSearch） */
  onReset: () => void;
  children: ReactNode;
}>;

type State = Readonly<{ failed: boolean }>;

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[${this.props.screen}] 渲染出错`, error, info.componentStack);
  }

  private reset = () => {
    this.setState({ failed: false });
    this.props.onReset();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="mx-auto flex max-w-command flex-col items-center gap-4 px-5 py-20 text-center">
        <TriangleAlert size={32} className="text-danger" aria-hidden="true" />
        <p className="text-lg font-semibold text-ink">{this.props.screen}渲染出错</p>
        <p className="text-ui text-ink-soft">页面其余部分不受影响。请返回首页后重新检索。</p>
        <Button onClick={this.reset}>返回首页</Button>
      </div>
    );
  }
}
