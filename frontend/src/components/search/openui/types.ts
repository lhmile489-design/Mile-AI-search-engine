// OpenUI 卡片共用的文本角标 props。

export type CardTextProps = Readonly<{
  /** 当前信源总数；[n] 超出范围按纯文本 */
  maxCitation: number;
  onCite: (index: number) => void;
}>;
