# 04 数据模型

## 设计原则

- 首版尽量少收集个人信息
- 用户默认匿名
- 聊天记录和 JD 原文不公开展示
- 风险报告必须保留证据片段，便于解释和纠错
- 用户反馈要结构化，减少情绪化内容

## users

匿名用户表。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 用户内部 ID |
| user_token | string | 匿名用户标识，可由浏览器本地生成或登录后绑定 |
| created_at | datetime | 创建时间 |
| last_active_at | datetime | 最近活跃时间 |
| is_deleted | boolean | 是否已删除 |

## job_reports

岗位检测报告表。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 报告 ID |
| user_id | string | 用户 ID，可为空 |
| source_platform | string | 招聘平台，如 BOSS、智联、猎聘 |
| company_name | string | 公司名称 |
| job_title | string | 岗位名称 |
| jd_text | text | 用户输入的 JD 原文，默认不公开 |
| hr_chat_text | text | 用户输入的 HR 聊天内容，默认不公开 |
| overall_score | number | 综合风险分 |
| risk_level | string | 低 / 中 / 高 / 极高 |
| confidence | string | 低 / 中 / 高 |
| recommendation | text | 总体建议 |
| evidence_json | json | 命中证据 |
| missing_info_json | json | 缺失信息 |
| questions_json | json | 追问问题 |
| sub_scores_json | json | 子模型分数 |
| strong_adjustment | number | 强风险修正项 |
| created_at | datetime | 创建时间 |

## company_snapshots

公司主体信息快照表。首版可先预留，不一定接 API。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 快照 ID |
| company_name | string | 公司名称 |
| unified_social_credit_code | string | 统一社会信用代码 |
| status | string | 存续、注销、吊销等 |
| established_date | date | 成立日期 |
| registered_capital | string | 注册资本 |
| insured_count | number | 参保人数 |
| address | string | 注册地址 |
| business_scope | text | 经营范围 |
| abnormal_count | number | 经营异常数量 |
| legal_case_count | number | 司法案件数量 |
| execution_count | number | 被执行记录数量 |
| source | string | 数据来源 |
| fetched_at | datetime | 获取时间 |

## interview_feedbacks

用户面试反馈表。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 反馈 ID |
| user_id | string | 用户 ID，可为空 |
| report_id | string | 关联报告 ID，可为空 |
| company_name | string | 公司名称 |
| job_title | string | 岗位名称 |
| source_platform | string | 招聘平台 |
| jd_claim | text | JD 写的内容 |
| interview_actual | text | 面试实际说的内容 |
| involves_sales | boolean | 是否涉及销售 |
| involves_fee | boolean | 是否涉及收费 |
| involves_training_loan | boolean | 是否涉及培训贷 |
| involves_deposit | boolean | 是否涉及押金 |
| subject_mismatch | boolean | 主体是否不一致 |
| recommend_to_others | string | 推荐 / 谨慎 / 不推荐 |
| is_public | boolean | 是否允许匿名用于统计 |
| review_status | string | 待审核 / 有效 / 无效 / 隐藏 |
| created_at | datetime | 创建时间 |

## risk_terms

风险词典表。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 词条 ID |
| term | string | 风险词 |
| category | string | 分类，如销售包装、薪资不透明 |
| risk_weight | number | 风险权重 |
| explanation | text | 用户可读解释 |
| suggested_question | text | 对应追问问题 |
| enabled | boolean | 是否启用 |

## report_feedbacks

报告纠错表。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 纠错 ID |
| report_id | string | 报告 ID |
| user_id | string | 用户 ID，可为空 |
| feedback_type | string | 判断不准 / 证据错误 / 公司信息错误 / 其他 |
| content | text | 反馈内容 |
| created_at | datetime | 创建时间 |

## enterprise_appeals

企业申诉表。首版可只做表单入口。

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 申诉 ID |
| company_name | string | 公司名称 |
| contact_name | string | 联系人 |
| contact_info | string | 联系方式 |
| appeal_content | text | 申诉说明 |
| proof_files | json | 证明材料 |
| status | string | 待处理 / 已处理 / 驳回 |
| created_at | datetime | 创建时间 |
