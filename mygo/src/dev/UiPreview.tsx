
import { useState, type ReactNode } from "react";
import { ArrowRight, BookOpen, Copy, Plus, Search, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, Panel } from "@/components/ui/Card";
import { Chip, ChipEmphasis } from "@/components/ui/Chip";
import { Switch } from "@/components/ui/Switch";
import { OpenUiCard } from "@/components/search/openui/OpenUiCard";

// 预览页只展示组件外观和状态，文案是组件说明，不是业务数据。
// 点击类组件把「最后一次点击」写进状态行，用来确认事件真的触发了。

function Section({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="grid gap-5">
      <h2 className="text-2xl font-bold leading-heading">{title}</h2>
      {children}
    </section>
  );
}

function Row({ children }: Readonly<{ children: ReactNode }>) {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}

export function UiPreview() {
  const [lastAction, setLastAction] = useState("尚未点击");
  const [cache, setCache] = useState(true);
  const [deep, setDeep] = useState(false);

  const record = (name: string) => () => setLastAction(name);

  return (
    <main className="mx-auto grid max-w-container gap-16 px-5 py-16">
      <header className="grid gap-4">
        <Badge tone="dark" className="justify-self-start">仅开发环境</Badge>
        <h1 className="text-display font-bold leading-display">基础组件预览</h1>
        <p className="max-w-lead text-base leading-body text-ink-soft">
          M0 基础组件的全部变体与状态。所有视觉值来自 DESIGN.md 令牌，生产构建下本页返回 404。
        </p>
        <p className="font-mono text-sm text-ink-soft" aria-live="polite">
          最后一次点击：{lastAction}
        </p>
      </header>

      <Section title="Button">
        <Row>
          <Button icon={Search} onClick={record("主按钮")}>
            开始检索
          </Button>
          <Button variant="secondary" icon={Copy} onClick={record("次按钮")}>
            复制 BibTeX
          </Button>
          <Button variant="ghost" icon={ArrowRight} onClick={record("幽灵按钮")}>
            查看全部信源
          </Button>
          <Button disabled icon={BookOpen}>
            元数据不全
          </Button>
        </Row>
        <Row>
          <Button icon={Plus} aria-label="添加信源过滤" onClick={record("图标主按钮")} />
          <Button variant="secondary" icon={X} aria-label="关闭抽屉" onClick={record("图标次按钮")} />
          <Button variant="ghost" icon={X} aria-label="清空输入" onClick={record("图标幽灵按钮")} />
          <Button disabled icon={Plus} aria-label="停用的图标按钮" />
        </Row>
      </Section>

      <Section title="Chip">
        <Row>
          <Chip>静态 chip</Chip>
          <Chip icon={Sparkles}>
            带图标与 <ChipEmphasis>强调字</ChipEmphasis>
          </Chip>
        </Row>
        <Row>
          <Chip icon={Search} onClick={record("可点击 chip 1")}>
            可点击 chip：悬停上浮
          </Chip>
          <Chip onClick={record("可点击 chip 2")}>
            <ChipEmphasis>可点击</ChipEmphasis> 带强调字
          </Chip>
        </Row>
      </Section>

      <Section title="Badge">
        <Row>
          <Badge>浅色</Badge>
          <Badge tone="dark">深色</Badge>
          <Badge dot={false}>无圆点</Badge>
          <Badge tone="dark" dot={false}>
            深色无圆点
          </Badge>
        </Row>
      </Section>

      <Section title="Card 与 Panel">
        <div className="grid gap-5 sm:grid-cols-3">
          <Card>
            <h3 className="text-lg font-bold leading-heading">静态卡片</h3>
            <p className="mt-3 text-ui leading-body text-ink-soft">elevation-2，不可点击，悬停不动。</p>
          </Card>
          <Card onClick={record("可点击卡片")}>
            <span className="block font-display text-lg font-bold leading-heading">可点击卡片</span>
            <span className="mt-3 block text-ui leading-body text-ink-soft">
              悬停上移 6px，阴影升到 elevation-4。
            </span>
          </Card>
          <Card>
            <h3 className="text-lg font-bold leading-heading">卡片内 badge</h3>
            <div className="mt-3">
              <Badge>elevation-1</Badge>
            </div>
          </Card>
        </div>
        <Panel label="面板示例">
          <div className="grid gap-2">
            <h3 className="text-lg font-bold leading-heading">面板（elevation-3）</h3>
            <p className="text-ui leading-body text-ink-soft">
              面板内部用 grid 排列，子项之间用分隔线，不再嵌套卡片。
            </p>
          </div>
          <div className="grid gap-4 border-t border-line pt-6">
            <Switch label="开关：开启态" checked={cache} onCheckedChange={setCache} />
            <Switch label="开关：关闭态" checked={deep} onCheckedChange={setDeep} />
          </div>
        </Panel>
      </Section>

      <Section title="Switch">
        <Row>
          <Switch label="可切换" checked={cache} onCheckedChange={setCache} />
          <Switch label="停用（关）" checked={false} onCheckedChange={() => undefined} disabled />
          <Switch label="停用（开）" checked onCheckedChange={() => undefined} disabled />
        </Row>
      </Section>

      <Section title="OpenUI 交互卡片（F11）">
        <p className="max-w-lead text-sm text-ink-soft">
          openui-lang 围栏块的真实渲染（DSL 见「DSL 源码」页签）。演示用样例数据，不是业务数据。
          第一张是后端实际下发的 `Table` 语法（generator.py 的 prompt），后两张是签名草案语法。
        </p>
        <OpenUiCard
          language="openui-lang"
          maxCitation={4}
          onCite={record("卡片内角标点击")}
          code={`root = Table("FA3 与 FA2 吞吐对比 [1]", [c1, c2, c3], [r1, r2, r3])
c1 = Column("kernel", "内核", false)
c2 = Column("precision", "精度", false)
c3 = Column("tflops", "吞吐 (TFLOPS)", true)
r1 = Row({"kernel": "FA2", "precision": "FP16", "tflops": "350"})
r2 = Row({"kernel": "FA3 [1]", "precision": "FP16", "tflops": "740 [1]"})
r3 = Row({"kernel": "FA3", "precision": "FP8", "tflops": "1200 [2]"})`}
        />
        <OpenUiCard
          language="openui-lang"
          maxCitation={4}
          onCite={record("卡片内角标点击")}
          code={`root = HardwareBenchmarkCard("FA3 与 FA2 吞吐对比 [1]", [c1, c2, c3], [r1, r2, r3], "H100 SXM5，8K 序列 [2]")
c1 = Column("kernel", "内核")
c2 = Column("precision", "精度")
c3 = Column("tflops", "吞吐 (TFLOPS)", true, true)
r1 = Row({kernel: "FA2", precision: "FP16", tflops: "350"})
r2 = Row({kernel: "FA3 [1]", precision: "FP16", tflops: "740 [1]"})
r3 = Row({kernel: "FA3 [1]", precision: "FP8", tflops: "1200 [2]"})`}
        />
        <OpenUiCard
          language="openui-lang"
          maxCitation={4}
          onCite={record("卡片内角标点击")}
          code={`root = PipelineClockCard("Hopper GEMM tile 流水线 [3]", "ns", [s1, s2, s3])
s1 = Stage("TMA 异步加载", 120, "从 HBM 搬运到共享内存，与上一 tile 计算重叠 [3]")
s2 = Stage("Tensor Core 计算", 340, "WGMMA 执行矩阵乘累加 [3]")
s3 = Stage("SMEM 写回", 60, "累加结果写回全局内存 [4]")`}
        />
        <p className="text-sm text-ink-muted">下面是一张解析失败的卡片（降级为 DSL 源码视图）：</p>
        <OpenUiCard
          language="openui-lang"
          maxCitation={4}
          onCite={record("卡片内角标点击")}
          code={'root = HardwareBenchmarkCard("缺列定义")'}
        />
      </Section>
    </main>
  );
}
