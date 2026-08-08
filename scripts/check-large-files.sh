#!/bin/bash

# 大文件监控脚本
# 用于定期检查项目中的大文件

set -e

echo "==================================="
echo "  大文件监控报告"
echo "==================================="
echo ""

# 配置
WARN_LINES=500
ERROR_LINES=1000
SRC_DIR="./src"

# 颜色
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# 统计
total_files=0
warn_files=0
error_files=0

echo "📊 扫描源代码文件..."
echo ""

# 查找所有源代码文件并统计行数
while IFS= read -r file; do
  lines=$(wc -l < "$file")
  total_files=$((total_files + 1))

  if [ "$lines" -ge "$ERROR_LINES" ]; then
    echo -e "${RED}🔴 $file${NC}"
    echo "   行数: $lines (超过 $ERROR_LINES 行)"
    error_files=$((error_files + 1))
  elif [ "$lines" -ge "$WARN_LINES" ]; then
    echo -e "${YELLOW}🟡 $file${NC}"
    echo "   行数: $lines (超过 $WARN_LINES 行)"
    warn_files=$((warn_files + 1))
  fi
done < <(find "$SRC_DIR" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) -not -path "*/node_modules/*" -not -path "*/.next/*" | sort)

echo ""
echo "==================================="
echo "  统计摘要"
echo "==================================="
echo ""
echo "总文件数: $total_files"
echo -e "${GREEN}✅ 正常文件 (< $WARN_LINES 行): $((total_files - warn_files - error_files))${NC}"
echo -e "${YELLOW}🟡 警告文件 ($WARN_LINES-$ERROR_LINES 行): $warn_files${NC}"
echo -e "${RED}🔴 需要优化 (> $ERROR_LINES 行): $error_files${NC}"
echo ""

# 列出前 10 大文件
echo "==================================="
echo "  Top 10 最大文件"
echo "==================================="
echo ""

find "$SRC_DIR" -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \) \
  -not -path "*/node_modules/*" -not -path "*/.next/*" \
  -exec wc -l {} \; | \
  sort -rn | \
  head -10 | \
  awk '{
    lines = $1
    file = $2
    if (lines >= 1000) {
      printf "\033[0;31m🔴 %5d 行\t%s\033[0m\n", lines, file
    } else if (lines >= 500) {
      printf "\033[1;33m🟡 %5d 行\t%s\033[0m\n", lines, file
    } else {
      printf "\033[0;32m✅ %5d 行\t%s\033[0m\n", lines, file
    }
  }'

echo ""

# 建议
if [ "$error_files" -gt 0 ]; then
  echo "==================================="
  echo "  优化建议"
  echo "==================================="
  echo ""
  echo "发现 $error_files 个超过 $ERROR_LINES 行的文件，建议："
  echo "1. 拆分大文件为多个小模块"
  echo "2. 提取可复用的逻辑到独立文件"
  echo "3. 使用自定义 Hooks 分离状态逻辑"
  echo "4. 参考 docs/optimization/large-files-analysis.md"
  echo ""
fi

# 退出码
if [ "$error_files" -gt 0 ]; then
  exit 1
else
  exit 0
fi
