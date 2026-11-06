// M1 探针用的 DSL 示例。数字是演示用的签名样例，不是业务数据，不会进入界面。
// 与 docs/OpenUI组件签名-草案.md 里的示例保持一致。

const benchmark = `root = HardwareBenchmarkCard("FlashAttention-3 与 FlashAttention-2 吞吐对比 [1]", [c1, c2, c3, c4], [r1, r2, r3], "H100 SXM5，序列长度 8K [2]")
c1 = Column("kernel", "内核", false, false)
c2 = Column("precision", "精度", false, false)
c3 = Column("tflops", "吞吐 (TFLOPS)", true, true)
c4 = Column("gain", "相比 FA2", true, false)
r1 = Row({kernel: "FlashAttention-2", precision: "FP16", tflops: "350", gain: "1.0x"})
r2 = Row({kernel: "FlashAttention-3", precision: "FP16", tflops: "740 [1]", gain: "2.1x [1]"})
r3 = Row({kernel: "FlashAttention-3", precision: "FP8", tflops: "1200 [2]", gain: "3.4x [2]"})`;

const clock = `root = PipelineClockCard("Hopper GEMM 单个 tile 的流水线 [3]", "ns", [s1, s2, s3])
s1 = Stage("TMA 异步加载", 120, "从 HBM 搬运 A、B tile 到共享内存，与上一 tile 的计算重叠 [3]")
s2 = Stage("Tensor Core 计算", 340, "WGMMA 指令执行矩阵乘累加 [3]")
s3 = Stage("SMEM 写回", 60, "累加结果经共享内存写回全局内存 [4]")`;

export const SAMPLES = {
  benchmark,
  clock,
  // 基准卡片的边界情况
  edge: {
    "教程写法（缩进子行 + 命名参数）": `HardwareBenchmarkCard(title="FA3 vs FA2 [1]")
  column(key="kernel", label="内核", sortable=false)
  row(kernel="FlashAttention-2", tflops="350")`,
    "可选参数省略（Column 只给 key、label，卡片无 note）": `root = HardwareBenchmarkCard("最简示例", [c1], [r1])
c1 = Column("kernel", "内核")
r1 = Row({kernel: "FA2"})`,
    "Row 里出现未定义的列键": `root = HardwareBenchmarkCard("未知列", [c1], [r1])
c1 = Column("kernel", "内核")
r1 = Row({kernel: "FA2", unknown: "x"})`,
    "单元格写成数字而不是字符串": `root = HardwareBenchmarkCard("数字单元格", [c1], [r1])
c1 = Column("tflops", "吞吐")
r1 = Row({tflops: 350})`,
    "引用了未定义的行": `root = HardwareBenchmarkCard("缺行", [c1], [r1, r2])
c1 = Column("kernel", "内核")
r1 = Row({kernel: "FA2"})`,
    "字符串里有转义引号": `root = HardwareBenchmarkCard("带 \\"引号\\" 的标题 [1]", [c1], [r1])
c1 = Column("kernel", "内核")
r1 = Row({kernel: "FA3 \\"beta\\""})`,
  },
  edgeClock: {
    "unit 不在枚举内": `root = PipelineClockCard("错误单位", "seconds", [s1])
s1 = Stage("加载", 1, "说明")`,
    "duration 写成字符串": `root = PipelineClockCard("字符串耗时", "ns", [s1])
s1 = Stage("加载", "120", "说明")`,
  },
};
